"""Acquire from an X "Download your data" archive: ``tweets.js`` to TweetRecords.

The archive is the analyst's own export: full history, no API, and crucially
the reply edges + media inline that syndication can't expose, so ``stitch`` can
rebuild real self-threads. We read only the copy-allowlisted entries
(``tweets.js`` plus ``tweets_media/``): a copy-allowlist fails safe where a
delete-denylist would leak the DMs / email / phone that ride in the same zip.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from app.services.storage import image_content_type_for_extension

from .chase import ChasedPost, apply_chase, chase_post
from .extract import is_retweet
from .records import ParsedMedia, QuotedTweet, SourceLink, TweetRecord
from .resolve import source_candidates
from .syndication import extract_source_links
from .urls import X_STATUS_URL_RE, is_trusted_media_url

# Byte cap on a single remote-media fetch: every chased CDN URL is streamed into
# memory under it. Sized for the upload ceilings (10 MB image / 95 MiB video)
# plus HTTP-framing overhead. Anything bigger is an unexpected upstream response
# or a hostile content-length lie; cap and bail so a fetch cannot buffer an
# unbounded stream in memory.
MEDIA_FETCH_MAX_BYTES = 110 * 1024 * 1024

# Each ``.js`` payload is wrapped ``window.YTD.tweets.part0 = [ ... ]``: strip
# the assignment prefix, then it's plain JSON.
_YTD_PREFIX_RE = re.compile(r"^\s*window\.YTD\.\w[\w-]*\.part\d+\s*=\s*")

# Twitter's ``created_at``: ``Wed Nov 12 14:33:00 +0000 2025``.
_TWITTER_TIME_FMT = "%a %b %d %H:%M:%S %z %Y"


def _to_iso(created_at: str) -> str:
    """Normalize Twitter's ``created_at`` to ISO 8601 (what ``detect`` expects).

    Falls back to the raw value if it's already ISO or otherwise unparseable:
    ``detect`` degrades to the epoch date rather than raising.
    """
    try:
        return datetime.strptime(created_at, _TWITTER_TIME_FMT).isoformat()
    except ValueError:
        return created_at


def _str_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _strip_ytd_prefix(text: str) -> Any:
    return json.loads(_YTD_PREFIX_RE.sub("", text, count=1))


def _tweet_text(tweet: dict[str, Any]) -> str:
    """An export entry's text: ``full_text``, falling back to ``text``.

    The first key holding a ``str`` wins, so a malformed non-string ``full_text``
    cannot mask a usable ``text``. Empty string when neither holds one.
    """
    for key in ("full_text", "text"):
        value = tweet.get(key)
        if isinstance(value, str):
            return value
    return ""


def _is_retweet(tweet: dict[str, Any]) -> bool:
    """Whether the entry is a retweet rather than a post the owner wrote.

    An export lists the account's retweets alongside its own tweets, and a
    retweet's content belongs to someone else: importing one would attribute a
    stranger's geolocation to the analyst running the import. Recognised by
    ``extract.is_retweet``, the same rule the detection engine applies to the
    live entries; dropping the entry here also keeps a retweet out of the
    stitching and out of the in-archive quote join.
    """
    return is_retweet(_tweet_text(tweet))


def _variant_bitrate(variant: dict[str, Any]) -> int:
    """A variant's bitrate as an int (the export serialises it as a string)."""
    try:
        return int(variant.get("bitrate") or 0)
    except (TypeError, ValueError):
        return 0


def _video_basename(entry: dict[str, Any]) -> str | None:
    """The local-file basename for a ``video`` / ``animated_gif`` entry.

    The export downloads one mp4 per video into ``tweets_media/``, named
    ``<tweet_id>-<basename>`` after the ``video_info`` mp4 variant it saved (the
    highest-bitrate one, the same pick the syndication extractor makes). The
    basename is the variant URL's last path segment, query string stripped.
    ``None`` when no usable mp4 variant exists; a wrong pick degrades to a
    missing file the fetcher skips, never a failure.
    """
    info = entry.get("video_info")
    variants = info.get("variants") if isinstance(info, dict) else None
    if not isinstance(variants, list):
        return None
    best: dict[str, Any] | None = None
    for variant in variants:
        if not isinstance(variant, dict) or variant.get("content_type") != "video/mp4":
            continue
        if not isinstance(variant.get("url"), str) or not variant["url"]:
            continue
        if best is None or _variant_bitrate(variant) > _variant_bitrate(best):
            best = variant
    if best is None:
        return None
    basename = best["url"].rsplit("/", 1)[-1].split("?", 1)[0]
    return basename or None


def _archive_media(tweet: dict[str, Any], tweet_id: str) -> list[ParsedMedia]:
    """Map a tweet's inline media to archive-relative ``ParsedMedia``.

    ``remote_url`` carries the archive-relative path, not a URL: the export
    names a tweet's media file ``tweets_media/<tweet_id>-<basename>``, and the
    archive media fetcher reads it from disk. Photos take the basename of
    ``media_url_https``; videos and animated gifs take the basename of the mp4
    variant the export saved (see :func:`_video_basename`).
    """
    container = tweet.get("extended_entities") or tweet.get("entities") or {}
    entries = container.get("media") if isinstance(container, dict) else None
    if not isinstance(entries, list):
        return []
    out: list[ParsedMedia] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        etype = entry.get("type")
        if etype == "photo":
            url = entry.get("media_url_https")
            if not isinstance(url, str) or not url:
                continue
            basename = url.rsplit("/", 1)[-1]
            content_type = image_content_type_for_extension(Path(basename).suffix)
            if content_type is None:
                continue
            out.append(
                ParsedMedia(
                    kind="image",
                    remote_url=f"tweets_media/{tweet_id}-{basename}",
                    content_type=content_type,
                )
            )
        elif etype in ("video", "animated_gif"):
            video_basename = _video_basename(entry)
            if video_basename is None:
                continue
            out.append(
                ParsedMedia(
                    kind="video",
                    remote_url=f"tweets_media/{tweet_id}-{video_basename}",
                    content_type="video/mp4",
                )
            )
    return out


def _linked_status_id(url: str) -> str | None:
    """The X status id in ``url`` (``X_STATUS_URL_RE``), or ``None``."""
    match = X_STATUS_URL_RE.search(url)
    return match.group(1) if match is not None else None


def _chase_candidate(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, owner_handle: str
) -> str | None:
    """The tweet's sole source candidate link, or ``None`` when it has none or
    several.

    The same rule the shared resolution runs (``resolve.source_candidates``), so
    the chase and the resolution can't disagree on which link is the source.
    ``by_id`` is the archive's own tweets: a linked id already in the export is
    the owner's own post (a cross-reference), never third-party footage, so it is
    dropped first, even in the handle-less ``i/web/status`` form the shared
    own-handle skip can't catch.

    Several candidates leave the source empty for review, so nothing is chased.
    """
    candidates = source_candidates(
        (
            url
            for url, _shortlink in extract_source_links(tweet)
            if _linked_status_id(url) not in by_id
        ),
        owner_handle=owner_handle,
    )
    return candidates[0] if len(candidates) == 1 else None


def _archive_quoted(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, handle: str
) -> QuotedTweet | None:
    """The tweet's quoted post, joined inside the export itself.

    Pure disk: both posts are in the same file, so the owner quoting their own
    post needs no fetch. A quote the export does not hold is the chase's job
    (:func:`_archive_chased`).
    """
    quoted_id = _str_or_none(tweet.get("quoted_status_id_str"))
    if quoted_id is None:
        return None
    src = by_id.get(quoted_id)
    if src is None:
        return None
    created_at = src.get("created_at")
    return QuotedTweet(
        tweet_id=quoted_id,
        handle=handle,  # an in-archive quote is the owner's own tweet
        text=_tweet_text(src),
        created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
        media=_archive_media(src, quoted_id),
    )


def _archive_chased(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, handle: str
) -> ChasedPost | None:
    """The footage post this entry points at, chased through the dispatcher.

    One target at most, and the entry names it two ways. A quote the export does
    not hold is chased by its post id; otherwise the entry's sole source
    candidate is chased by its URL, and a chase that comes back authored by the
    owner is a self-reference (a link to their own post absent from the export
    slips the ``by_id`` exclusion), never footage. An entry that quotes a post
    the export does hold needs nothing: the join already filled the slot.

    Which technology answers is ``chase.chase_post``'s business, so a link it
    does not serve, an Instagram or TikTok URL, stays link-only. Fail-soft: a
    chase that yields nothing leaves the record with the link alone.
    """
    quoted_id = _str_or_none(tweet.get("quoted_status_id_str"))
    if quoted_id is not None:
        return None if quoted_id in by_id else chase_post(quoted_id)
    candidate = _chase_candidate(tweet, by_id, owner_handle=handle)
    if candidate is None:
        return None
    chased = chase_post(candidate)
    if chased is not None and (chased.author or "").lower() == handle.lower():
        return None
    return chased


def read_tweets(archive_dir: Path, *, handle: str, chase: bool = False) -> list[TweetRecord]:
    """Parse ``tweets.js`` under ``archive_dir`` into enriched ``TweetRecord``s.

    ``handle`` is the verified owner handle; the export is the owner's own
    tweets. Each record carries the inline reply edges (so ``stitch`` rebuilds
    real self-threads), the OP media, the links it carries (``entities.urls``),
    the quoted post joined inside the export, and, when ``chase`` is on, the
    footage the entry points at off the export (:func:`_archive_chased`).
    ``chase`` stays off by default so the read is pure-disk.

    Retweets (:func:`_is_retweet`) are dropped here, the earliest point that
    can tell them apart, so nothing downstream can attribute another account's
    post to ``handle``.
    """
    raw = (archive_dir / "tweets.js").read_text(encoding="utf-8")
    entries = _strip_ytd_prefix(raw)
    if not isinstance(entries, list):
        return []

    tweets = [
        entry["tweet"]
        for entry in entries
        if isinstance(entry, dict)
        and isinstance(entry.get("tweet"), dict)
        and not _is_retweet(entry["tweet"])
    ]
    # For the in-archive quote join (the owner quote-tweeting their own post).
    by_id = {t["id_str"]: t for t in tweets if isinstance(t.get("id_str"), str)}

    records: list[TweetRecord] = []
    for tweet in tweets:
        tweet_id = tweet.get("id_str")
        # ``id_str`` is woven into a filesystem path (``tweets_media/<id>-...``)
        # and the export is attacker-controlled, so reject anything that isn't
        # digits-only before it can carry ``..`` or a separator into the path.
        if not isinstance(tweet_id, str) or not tweet_id.isdigit():
            continue
        created_at = tweet.get("created_at")
        record = TweetRecord(
            tweet_id=tweet_id,
            handle=handle,
            text=_tweet_text(tweet),
            created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
            media=_archive_media(tweet, tweet_id),
            in_reply_to_status_id=_str_or_none(tweet.get("in_reply_to_status_id_str")),
            in_reply_to_user_id=_str_or_none(tweet.get("in_reply_to_user_id_str")),
            quoted=_archive_quoted(tweet, by_id, handle=handle),
            external_sources=[
                SourceLink(url=u, shortlink=t) for u, t in extract_source_links(tweet)
            ],
        )
        if chase:
            chased = _archive_chased(tweet, by_id, handle=handle)
            if chased is not None:
                record = apply_chase(record, chased)
        records.append(record)
    return records


async def fetch_cdn_media(parsed: ParsedMedia) -> tuple[bytes, str] | None:
    """Fetch a chased source media from a CDN.

    A chase carries absolute CDN URLs in ``remote_url``, unlike the archive's own
    media, which are ``tweets_media/`` disk paths. SSRF-guarded by
    ``is_trusted_media_url``, the one host allowlist. Streamed with a byte cap
    (``MEDIA_FETCH_MAX_BYTES``) so a hostile or buggy CDN file that lies about
    its size can't OOM the worker; over the cap degrades to ``None``
    (media-incomplete), fail-soft like a fetch error.
    """
    if not is_trusted_media_url(parsed.remote_url):
        return None
    try:
        async with (
            httpx.AsyncClient(timeout=20.0) as client,
            client.stream("GET", parsed.remote_url) as resp,
        ):
            if resp.status_code != 200:
                return None
            buffer = bytearray()
            async for chunk in resp.aiter_bytes():
                buffer.extend(chunk)
                if len(buffer) > MEDIA_FETCH_MAX_BYTES:
                    return None
    except httpx.HTTPError:
        return None
    if not buffer:
        return None
    return bytes(buffer), parsed.content_type


def archive_media_fetcher(
    archive_dir: Path,
) -> Callable[[ParsedMedia], Awaitable[tuple[bytes, str] | None]]:
    """A media fetcher for a backfill: the archive's own media from
    ``tweets_media/`` on disk, chased source media from the CDN it lives on.

    Matches the assemble step's ``MediaFetcher`` signature and dispatches on
    ``remote_url``: an absolute URL is a chased source media (CDN); anything else
    is the archive-relative disk path. Returns ``None`` for a missing / untrusted
    media, so the detection persists media-incomplete rather than failing the
    whole backfill.
    """

    base = archive_dir.resolve()

    async def fetch(parsed: ParsedMedia) -> tuple[bytes, str] | None:
        if parsed.remote_url.startswith("http"):
            return await fetch_cdn_media(parsed)
        # Defence in depth behind ``read_tweets``' id check: never read outside
        # the extraction dir, whatever ``remote_url`` resolves to.
        target = (base / parsed.remote_url).resolve()
        if not target.is_relative_to(base):
            return None
        try:
            return target.read_bytes(), parsed.content_type
        except OSError:
            return None

    return fetch
