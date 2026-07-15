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
from .records import QuotedTweet, SourceLink, TweetRecord
from .syndication import (
    _X_STATUS_URL_RE,
    ParsedMedia,
    _extract_media,
    extract_source_links,
    fetch_syndication,
    is_trusted_media_url,
)

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


def _sole_linked_x_status(tweet: dict[str, Any], by_id: dict[str, dict[str, Any]]) -> str | None:
    """The id of the only third-party X status the tweet links
    (``entities.urls``), or ``None`` when there is none or several.

    OSINT posts often write ``Source: https://x.com/<author>/status/<id>`` for
    the footage they geolocated; that status is the source tweet. ``by_id`` is
    the archive's own tweets: a linked id that is in there is the analyst's own
    post (a cross-reference), never third-party footage, so it is excluded
    first. When several distinct candidates remain the source is ambiguous, so
    none is chased and the source stays empty for review; the same id linked
    twice is one candidate. A profile link (no ``/status/``) doesn't match,
    same rule ``classify_source_host`` applies (``_X_STATUS_URL_RE``, the
    single source of truth for both).
    """
    urls = (tweet.get("entities") or {}).get("urls")
    if not isinstance(urls, list):
        return None
    candidates: set[str] = set()
    for entry in urls:
        if not isinstance(entry, dict):
            continue
        expanded = entry.get("expanded_url")
        if not isinstance(expanded, str):
            continue
        match = _X_STATUS_URL_RE.search(expanded)
        if match is None:
            continue
        status_id = match.group(1)
        if status_id in by_id:
            continue
        candidates.add(status_id)
    if len(candidates) == 1:
        return next(iter(candidates))
    return None


def _archive_quoted(
    tweet: dict[str, Any], by_id: dict[str, dict[str, Any]], *, handle: str, chase: bool
) -> QuotedTweet | None:
    """Resolve a tweet's footage source tweet.

    A literal quote first (in-archive join, or a syndication chase of a
    third-party quote); else, when ``chase`` is on, the sole third-party linked
    X status (``Source: https://x.com/.../status/...``) chased via syndication.
    ``None`` when nothing resolves. Held in the record's ``quoted`` field, but
    it is "the source tweet" whether it came from a quote or a link.
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
        linked = _sole_linked_x_status(tweet, by_id)
        if linked is not None:
            return _quoted_from_syndication(linked)
    return None


def read_tweets(archive_dir: Path, *, handle: str, chase: bool = False) -> list[TweetRecord]:
    """Parse ``tweets.js`` under ``archive_dir`` into enriched ``TweetRecord``s.

    ``handle`` is the verified owner handle; the export is the owner's own
    tweets. Each record carries the inline reply edges (so ``stitch`` rebuilds
    real self-threads), the OP media, the host-classified source links
    (``entities.urls``), and the resolved quoted tweet: an in-archive join, or a
    syndication chase of a third-party quote when ``chase`` is on (``chase``
    stays off by default so the read is pure-disk).
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
                external_sources=[
                    SourceLink(url=u, host=h) for u, h in extract_source_links(tweet)
                ],
            )
        )
    return records


async def _fetch_cdn_media(parsed: ParsedMedia) -> tuple[bytes, str] | None:
    """Fetch a chased source media from the X CDN (``pbs`` / ``video.twimg.com``).

    Chased source tweets carry absolute CDN URLs in ``remote_url`` (unlike the
    archive's own media, which are ``tweets_media/`` disk paths). SSRF-guarded by
    the same host allowlist the media proxy uses.
    """
    if not is_trusted_media_url(parsed.remote_url):
        return None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(parsed.remote_url)
    except httpx.HTTPError:
        return None
    if resp.status_code == 200 and resp.content:
        return resp.content, parsed.content_type
    return None


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
