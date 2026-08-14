"""Acquire from an X "Download your data" archive — ``tweets.js`` → TweetRecords.

The archive is the analyst's own export: full history, no API, and crucially
the reply edges + media inline that syndication can't expose, so ``stitch`` can
rebuild real self-threads. We read only the copy-allowlisted entries
(``tweets.js`` + ``tweets_media/``) — a copy-allowlist fails safe where a
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

from .acquire import quoted_from_syndication
from .records import QuotedTweet, SourceLink, TelegramFootage, TweetRecord
from .resolve import FootageCandidate, designated_source, footage_candidates
from .syndication import (
    _X_STATUS_URL_RE,
    MEDIA_FETCH_MAX_BYTES,
    ParsedMedia,
    extract_media_shortlinks,
    extract_source_links,
    is_trusted_media_url,
)
from .telegram import fetch_telegram_embed

# Each ``.js`` payload is wrapped ``window.YTD.tweets.part0 = [ ... ]`` — strip
# the assignment prefix, then it's plain JSON.
_YTD_PREFIX_RE = re.compile(r"^\s*window\.YTD\.\w[\w-]*\.part\d+\s*=\s*")

# Twitter's ``created_at``: ``Wed Nov 12 14:33:00 +0000 2025``.
_TWITTER_TIME_FMT = "%a %b %d %H:%M:%S %z %Y"

# The retweet discriminator, and the one home for why the text is the only
# reliable signal in archive data. An export entry carries no flag worth
# trusting: there is no ``retweeted_status`` object (the exporter drops it) and
# the ``retweeted`` boolean is written ``false`` on every entry, retweets
# included. What does survive is the text X stores for a retweet,
# ``RT @<handle>: <original text>``, so the prefix is the signal. A handle is
# 1-15 word characters and the colon must follow, which keeps a tweet that
# merely opens on the letters "RT" out of the match. Callers match with
# ``.match()``, which anchors on its own; the ``^`` is redundant there and stays
# so the intent survives a move to ``.search()``. The heuristic's deliberate
# boundary: X writes the canonical form, so variants like a lowercase ``rt`` or
# a missing colon are out of scope, and a post the owner hand-typed with the
# canonical prefix is dropped along with real retweets, its content being
# someone else's either way.
_RETWEET_PREFIX_RE = re.compile(r"^RT @[A-Za-z0-9_]{1,15}:")


def _to_iso(created_at: str) -> str:
    """Normalize Twitter's ``created_at`` to ISO 8601 (what ``detect`` expects).

    Falls back to the raw value if it's already ISO or otherwise unparseable —
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
    ``_RETWEET_PREFIX_RE`` (see there for why the text is the only reliable
    signal in archive data).
    """
    return _RETWEET_PREFIX_RE.match(_tweet_text(tweet)) is not None


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
    """The X status id in ``url`` (``_X_STATUS_URL_RE``), or ``None``."""
    match = _X_STATUS_URL_RE.search(url)
    return match.group(1) if match is not None else None


def _chase_candidate(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, owner_handle: str
) -> FootageCandidate | None:
    """The footage candidate behind the OP's links, or ``None`` when the tweet
    designates none.

    The same two rules the shared resolution runs, in the same order, so the
    chase and the resolution can't disagree on which link is the source: an
    explicit ``Source: <url>`` line (``resolve.designated_source``) first, then
    the sole footage candidate (``resolve.footage_candidates``). Both are fed the
    host-classified ``entities.urls``. ``by_id`` is the archive's own tweets: a
    linked id already in the export is the owner's own post (a cross-reference),
    never third-party footage, so it is dropped first, even in the handle-less
    ``i/web/status`` form the shared own-handle skip can't catch.

    A chase runs only when the candidate is an X status or a Telegram post,
    designated or not: the vocabulary decides what gets fetched, so a designated
    Instagram / TikTok / article link stays link-only. Without a designation, a
    mixed pair (an X status plus a Telegram / YouTube link) is ambiguous, so
    nothing chases and the source stays empty for review.
    """
    links = [
        SourceLink(url=url, host=host, shortlink=shortlink)
        for url, host, shortlink in extract_source_links(tweet)
        if _linked_status_id(url) not in by_id
    ]
    designated = designated_source(
        _tweet_text(tweet),
        links,
        owner_handle=owner_handle,
        media_shortlinks=extract_media_shortlinks(tweet),
    )
    if designated is not None:
        return designated
    candidates = footage_candidates(
        [(link.url, link.host) for link in links], owner_handle=owner_handle
    )
    return candidates[0] if len(candidates) == 1 else None


def _archive_quoted(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, handle: str, chase: bool
) -> QuotedTweet | None:
    """Resolve a tweet's footage source tweet.

    A literal quote first (in-archive join, or a syndication chase of a
    third-party quote); else, when ``chase`` is on and the tweet's footage
    candidate (:func:`_chase_candidate`) is a third-party X status, that status
    chased via syndication. ``None`` when nothing resolves. Held in the
    record's ``quoted`` field, but it is "the source tweet" whether it came from a
    quote or a link.
    """
    quoted_id = _str_or_none(tweet.get("quoted_status_id_str"))
    if quoted_id is not None:
        src = by_id.get(quoted_id)
        if src is not None:
            created_at = src.get("created_at")
            return QuotedTweet(
                tweet_id=quoted_id,
                handle=handle,  # an in-archive quote is the owner's own tweet
                text=_tweet_text(src),
                created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
                media=_archive_media(src, quoted_id),
            )
        return quoted_from_syndication(quoted_id) if chase else None
    if chase:
        candidate = _chase_candidate(tweet, by_id, owner_handle=handle)
        if candidate is not None and candidate.host == "x" and candidate.status_id is not None:
            quoted = quoted_from_syndication(candidate.status_id)
            if quoted is not None and quoted.handle.lower() == handle.lower():
                # A link to the owner's OWN status absent from the export (deleted
                # tweet, truncated archive) slips the ``by_id`` exclusion; the
                # chased handle reveals it as a self-reference, never footage.
                return None
            return quoted
    return None


def _archive_telegram(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, handle: str, chase: bool
) -> TelegramFootage | None:
    """Chase the tweet's sole Telegram footage link via its public embed.

    OSINT posts write ``Source: https://t.me/<channel>/<id>`` for off-platform
    footage. When ``chase`` is on and the tweet's footage candidate is a Telegram
    post (:func:`_chase_candidate`, the shared designation + ambiguity rules),
    fetch its embed for the post date and (when the embed serves it) the footage
    media. An undesignated tweet that also links another footage source is
    ambiguous, so nothing is chased.
    Fail-soft: ``fetch_telegram_embed`` returns ``None`` on any error, and the
    record then keeps the link with no date, exactly as before the chase existed.
    """
    if not chase:
        return None
    candidate = _chase_candidate(tweet, by_id, owner_handle=handle)
    if candidate is None or candidate.host != "telegram":
        return None
    embed = fetch_telegram_embed(candidate.url)
    if embed is None:
        return None
    return TelegramFootage(url=candidate.url, posted_at=embed.posted_at, media=list(embed.media))


def read_tweets(archive_dir: Path, *, handle: str, chase: bool = False) -> list[TweetRecord]:
    """Parse ``tweets.js`` under ``archive_dir`` into enriched ``TweetRecord``s.

    ``handle`` is the verified owner handle; the export is the owner's own
    tweets. Each record carries the inline reply edges (so ``stitch`` rebuilds
    real self-threads), the OP media, the host-classified source links
    (``entities.urls``), the resolved quoted tweet (an in-archive join, or a
    syndication chase of a third-party quote when ``chase`` is on), and, when
    ``chase`` is on and the OP links a sole Telegram post, that post's chased
    footage (date + maybe media). ``chase`` stays off by default so the read is
    pure-disk.

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
        records.append(
            TweetRecord(
                tweet_id=tweet_id,
                handle=handle,
                text=_tweet_text(tweet),
                created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
                permalink=f"https://x.com/{handle}/status/{tweet_id}",
                media=_archive_media(tweet, tweet_id),
                media_shortlinks=extract_media_shortlinks(tweet),
                in_reply_to_status_id=_str_or_none(tweet.get("in_reply_to_status_id_str")),
                in_reply_to_user_id=_str_or_none(tweet.get("in_reply_to_user_id_str")),
                quoted=_archive_quoted(tweet, by_id, handle=handle, chase=chase),
                telegram=_archive_telegram(tweet, by_id, handle=handle, chase=chase),
                external_sources=[
                    SourceLink(url=u, host=h, shortlink=t)
                    for u, h, t in extract_source_links(tweet)
                ],
            )
        )
    return records


async def fetch_cdn_media(parsed: ParsedMedia) -> tuple[bytes, str] | None:
    """Fetch a chased source media from the X or Telegram CDN.

    Chased source tweets (X status) and chased Telegram embeds carry absolute CDN
    URLs in ``remote_url`` (unlike the archive's own media, which are
    ``tweets_media/`` disk paths). SSRF-guarded by ``is_trusted_media_url``, the
    same host allowlist the media proxy uses. Streamed with a byte cap
    (``MEDIA_FETCH_MAX_BYTES``, shared with the proxy) so a hostile / buggy CDN
    file that lies about its size can't OOM the worker; over the cap degrades to
    ``None`` (media-incomplete), fail-soft like a fetch error.
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
    ``tweets_media/`` on disk, chased source media from the X CDN.

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
