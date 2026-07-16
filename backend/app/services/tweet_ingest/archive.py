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

from .errors import TweetFetchFailed, TweetNotAccessible
from .records import QuotedTweet, SourceLink, TelegramFootage, TweetRecord
from .resolve import FootageCandidate, footage_candidates
from .syndication import (
    _X_STATUS_URL_RE,
    MEDIA_FETCH_MAX_BYTES,
    ParsedMedia,
    _extract_media,
    extract_source_links,
    fetch_syndication,
    is_trusted_media_url,
)
from .telegram import fetch_telegram_embed

# Each ``.js`` payload is wrapped ``window.YTD.tweets.part0 = [ ... ]`` — strip
# the assignment prefix, then it's plain JSON.
_YTD_PREFIX_RE = re.compile(r"^\s*window\.YTD\.\w[\w-]*\.part\d+\s*=\s*")

# Twitter's ``created_at``: ``Wed Nov 12 14:33:00 +0000 2025``.
_TWITTER_TIME_FMT = "%a %b %d %H:%M:%S %z %Y"

_IMAGE_CONTENT_TYPE = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


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
            content_type = _IMAGE_CONTENT_TYPE.get(Path(basename).suffix.lower())
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


def _quoted_from_syndication(quoted_id: str) -> QuotedTweet | None:
    """Chase a third-party quoted tweet (not in the archive) via syndication.

    Fail-soft: a fetch error degrades to "no quote" and never fails the backfill.
    """
    try:
        body = fetch_syndication(quoted_id)
    except (TweetFetchFailed, TweetNotAccessible):
        return None
    user = body.get("user")
    handle = user.get("screen_name") if isinstance(user, dict) else None
    if not isinstance(handle, str) or not handle:
        return None
    text = body.get("text")
    created_at = body.get("created_at")
    return QuotedTweet(
        tweet_id=quoted_id,
        handle=handle,
        text=text if isinstance(text, str) else "",
        created_at=created_at if isinstance(created_at, str) else "",
        media=list(_extract_media(body, origin="quote")),
    )


def _linked_status_id(url: str) -> str | None:
    """The X status id in ``url`` (``_X_STATUS_URL_RE``), or ``None``."""
    match = _X_STATUS_URL_RE.search(url)
    return match.group(1) if match is not None else None


def _sole_footage_candidate(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, owner_handle: str
) -> FootageCandidate | None:
    """The single footage candidate the OP links, or ``None`` when there is none
    or several.

    Decided by ``resolve.footage_candidates`` (the shared rule, so the chase and
    the resolution can't disagree on which link is the source), fed the
    host-classified ``entities.urls``. ``by_id`` is the archive's own tweets: a
    linked id already in the export is the owner's own post (a cross-reference),
    never third-party footage, so it is dropped first, even in the handle-less
    ``i/web/status`` form the shared own-handle skip can't catch. A chase runs
    only when this sole candidate is an X status or a Telegram post; a mixed pair
    (an X status plus a Telegram / YouTube link) is ambiguous, so nothing chases
    and the source stays empty for review.
    """
    links = [
        (url, host)
        for url, host in extract_source_links(tweet)
        if _linked_status_id(url) not in by_id
    ]
    candidates = footage_candidates(links, owner_handle=owner_handle)
    return candidates[0] if len(candidates) == 1 else None


def _archive_quoted(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, handle: str, chase: bool
) -> QuotedTweet | None:
    """Resolve a tweet's footage source tweet.

    A literal quote first (in-archive join, or a syndication chase of a
    third-party quote); else, when ``chase`` is on and the sole footage candidate
    is a third-party X status (``Source: https://x.com/.../status/...``), that
    status chased via syndication. ``None`` when nothing resolves. Held in the
    record's ``quoted`` field, but it is "the source tweet" whether it came from a
    quote or a link.
    """
    quoted_id = _str_or_none(tweet.get("quoted_status_id_str"))
    if quoted_id is not None:
        src = by_id.get(quoted_id)
        if src is not None:
            text = src.get("full_text") or src.get("text") or ""
            created_at = src.get("created_at")
            return QuotedTweet(
                tweet_id=quoted_id,
                handle=handle,  # an in-archive quote is the owner's own tweet
                text=text if isinstance(text, str) else "",
                created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
                media=_archive_media(src, quoted_id),
            )
        return _quoted_from_syndication(quoted_id) if chase else None
    if chase:
        candidate = _sole_footage_candidate(tweet, by_id, owner_handle=handle)
        if candidate is not None and candidate.host == "x" and candidate.status_id is not None:
            quoted = _quoted_from_syndication(candidate.status_id)
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
    footage. When ``chase`` is on and the sole footage candidate is a Telegram
    post (``_sole_footage_candidate``, the shared ambiguity rule), fetch its embed
    for the post date and (when the embed serves it) the footage media. A tweet
    that also links another footage source is ambiguous, so nothing is chased.
    Fail-soft: ``fetch_telegram_embed`` returns ``None`` on any error, and the
    record then keeps the link with no date, exactly as before the chase existed.
    """
    if not chase:
        return None
    candidate = _sole_footage_candidate(tweet, by_id, owner_handle=handle)
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
    """
    raw = (archive_dir / "tweets.js").read_text(encoding="utf-8")
    entries = _strip_ytd_prefix(raw)
    if not isinstance(entries, list):
        return []

    tweets = [
        entry["tweet"]
        for entry in entries
        if isinstance(entry, dict) and isinstance(entry.get("tweet"), dict)
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
        text = tweet.get("full_text") or tweet.get("text") or ""
        created_at = tweet.get("created_at")
        records.append(
            TweetRecord(
                tweet_id=tweet_id,
                handle=handle,
                text=text if isinstance(text, str) else "",
                created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
                permalink=f"https://x.com/{handle}/status/{tweet_id}",
                media=_archive_media(tweet, tweet_id),
                in_reply_to_status_id=_str_or_none(tweet.get("in_reply_to_status_id_str")),
                in_reply_to_user_id=_str_or_none(tweet.get("in_reply_to_user_id_str")),
                quoted=_archive_quoted(tweet, by_id, handle=handle, chase=chase),
                telegram=_archive_telegram(tweet, by_id, handle=handle, chase=chase),
                external_sources=[
                    SourceLink(url=u, host=h) for u, h in extract_source_links(tweet)
                ],
            )
        )
    return records


async def _fetch_cdn_media(parsed: ParsedMedia) -> tuple[bytes, str] | None:
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
            return await _fetch_cdn_media(parsed)
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
