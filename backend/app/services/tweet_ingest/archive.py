"""Acquire from an X "Download your data" archive: ``tweets.js`` to TweetRecords.

The export carries the reply edges and media inline that syndication cannot
expose, so ``stitch`` can rebuild self-threads. Only the copy-allowlisted
entries are read (see ``archive_zip``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from .errors import TweetImportError, TweetUpstreamBusy, TweetUpstreamUnreachable
from .extract import is_retweet
from .records import ParsedMedia, QuotedTweet, SourceLink, TweetRecord
from .retry import parse_retry_after, retrying_async
from .syndication import extract_source_links, media_entry
from .urls import is_trusted_media_url

# Byte cap on one remote-media fetch, streamed into memory: the upload ceilings
# (10 MB image / 95 MiB video) plus framing overhead. Larger is hostile or
# unexpected, so bail rather than buffer an unbounded stream.
MEDIA_FETCH_MAX_BYTES = 110 * 1024 * 1024

# Each ``.js`` payload is ``window.YTD.tweets.part0 = [ ... ]``: strip the prefix for JSON.
_YTD_PREFIX_RE = re.compile(r"^\s*window\.YTD\.\w[\w-]*\.part\d+\s*=\s*")

# Twitter's ``created_at``: ``Wed Nov 12 14:33:00 +0000 2025``.
_TWITTER_TIME_FMT = "%a %b %d %H:%M:%S %z %Y"


def _to_iso(created_at: str) -> str:
    """Normalize Twitter's ``created_at`` to ISO 8601; an unparseable value is
    returned as is (the resolution degrades to the epoch date)."""
    try:
        return datetime.strptime(created_at, _TWITTER_TIME_FMT).isoformat()
    except ValueError:
        return created_at


def _str_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _strip_ytd_prefix(text: str) -> Any:
    return json.loads(_YTD_PREFIX_RE.sub("", text, count=1))


def _tweet_text(tweet: dict[str, Any]) -> str:
    """An export entry's ``full_text``, else ``text``; the first ``str`` wins, else ``""``."""
    for key in ("full_text", "text"):
        value = tweet.get(key)
        if isinstance(value, str):
            return value
    return ""


def _is_retweet(tweet: dict[str, Any]) -> bool:
    """Whether the entry is a retweet (``extract.is_retweet``, as for live entries).

    Importing one would attribute a stranger's geolocation to the analyst.
    """
    return is_retweet(_tweet_text(tweet))


def _archive_media(tweet: dict[str, Any], tweet_id: str) -> list[ParsedMedia]:
    """Map a tweet's inline media to archive-relative ``ParsedMedia``.

    ``remote_url`` is the path ``tweets_media/<tweet_id>-<basename>``, the basename
    being the last segment of the declared URL (``syndication.media_entry`` picks
    a video's highest-bitrate mp4, the one the export saved). It names the file
    only (the stored type is ``records.PHOTO_CONTENT_TYPE``); a missing file
    degrades to an empty fetch.
    """
    container = tweet.get("extended_entities") or tweet.get("entities") or {}
    entries = container.get("media") if isinstance(container, dict) else None
    if not isinstance(entries, list):
        return []
    out: list[ParsedMedia] = []
    for entry in entries:
        read = media_entry(entry)
        if read is None:
            continue
        kind, url = read
        basename = url.rsplit("/", 1)[-1].split("?", 1)[0]
        if not basename:
            continue
        out.append(ParsedMedia(kind=kind, remote_url=f"tweets_media/{tweet_id}-{basename}"))
    return out


def _archive_quoted(
    quoted_id: str | None, by_id: dict[str, dict[str, Any]], *, handle: str
) -> QuotedTweet | None:
    """The quoted post ``quoted_id`` names, joined inside the export (no fetch).

    A quote the export lacks stays unresolved (``TweetRecord.quoted_status_id``,
    read by ``chase.chase_thread``).
    """
    src = by_id.get(quoted_id) if quoted_id is not None else None
    if quoted_id is None or src is None:
        return None
    created_at = src.get("created_at")
    return QuotedTweet(
        tweet_id=quoted_id,
        handle=handle,  # an in-archive quote is the owner's own tweet
        text=_tweet_text(src),
        created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
        media=_archive_media(src, quoted_id),
        external_sources=[SourceLink(url=u, shortlink=t) for u, t in extract_source_links(src)],
    )


def read_tweets(archive_dir: Path, *, handle: str) -> list[TweetRecord]:
    """Parse ``tweets.js`` under ``archive_dir`` into ``TweetRecord``s (pure disk).

    ``handle`` is the verified owner handle. Records carry reply edges, OP media,
    links and the in-export quoted post. Retweets are dropped here, so nothing
    downstream attributes another account's post to ``handle``.
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
    # For the in-archive quote join.
    by_id = {t["id_str"]: t for t in tweets if isinstance(t.get("id_str"), str)}

    records: list[TweetRecord] = []
    for tweet in tweets:
        tweet_id = tweet.get("id_str")
        # ``id_str`` enters a filesystem path and the export is attacker-controlled:
        # digits only, so no ``..`` or separator.
        if not isinstance(tweet_id, str) or not tweet_id.isdigit():
            continue
        created_at = tweet.get("created_at")
        quoted_id = _str_or_none(tweet.get("quoted_status_id_str"))
        records.append(
            TweetRecord(
                tweet_id=tweet_id,
                handle=handle,
                text=_tweet_text(tweet),
                created_at=_to_iso(created_at) if isinstance(created_at, str) else "",
                media=_archive_media(tweet, tweet_id),
                in_reply_to_status_id=_str_or_none(tweet.get("in_reply_to_status_id_str")),
                quoted=_archive_quoted(quoted_id, by_id, handle=handle),
                quoted_status_id=quoted_id,
                external_sources=[
                    SourceLink(url=u, shortlink=t) for u, t in extract_source_links(tweet)
                ],
            )
        )
    return records


async def fetch_cdn_media(parsed: ParsedMedia) -> tuple[bytes, str] | None:
    """Fetch a chased source media from a CDN (absolute ``remote_url``).

    SSRF-guarded by ``is_trusted_media_url``. Streamed under
    ``MEDIA_FETCH_MAX_BYTES`` so a CDN lying about size cannot OOM the worker;
    over the cap, or any fetch error, degrades to ``None`` (media-incomplete).
    A throttled or unreachable CDN is retried (:mod:`tweet_ingest.retry`) first.
    """
    if not is_trusted_media_url(parsed.remote_url):
        return None
    try:
        media = await retrying_async(
            lambda: _read_cdn_media(parsed.remote_url), what=parsed.remote_url
        )
    except TweetImportError:
        return None
    return (media, parsed.content_type) if media else None


async def _read_cdn_media(url: str) -> bytes | None:
    """One streamed GET: the bytes, or ``None`` where a retry cannot help (a
    non-throttling refusal, an over-cap body). Throttling or an unreachable CDN
    raises, which earns the retry."""
    try:
        async with (
            httpx.AsyncClient(timeout=20.0) as client,
            client.stream("GET", url) as resp,
        ):
            if resp.status_code == 429 or resp.status_code >= 500:
                raise TweetUpstreamBusy(
                    f"cdn returned {resp.status_code}",
                    retry_after=parse_retry_after(resp.headers.get("Retry-After")),
                )
            if resp.status_code != 200:
                return None
            buffer = bytearray()
            async for chunk in resp.aiter_bytes():
                buffer.extend(chunk)
                if len(buffer) > MEDIA_FETCH_MAX_BYTES:
                    return None
    except httpx.HTTPError as exc:
        raise TweetUpstreamUnreachable(f"transport error: {exc}") from exc
    return bytes(buffer)


def archive_media_fetcher(
    archive_dir: Path,
) -> Callable[[ParsedMedia], Awaitable[tuple[bytes, str] | None]]:
    """A backfill media fetcher (the assemble step's ``MediaFetcher``).

    An absolute ``remote_url`` is chased source media (CDN); anything else is
    an archive-relative disk path. A missing or untrusted media returns ``None``,
    so the detection persists media-incomplete.
    """
    base = archive_dir.resolve()

    async def fetch(parsed: ParsedMedia) -> tuple[bytes, str] | None:
        if parsed.remote_url.startswith("http"):
            return await fetch_cdn_media(parsed)
        # Defence in depth behind ``read_tweets``' id check.
        target = (base / parsed.remote_url).resolve()
        if not target.is_relative_to(base):
            return None
        try:
            return target.read_bytes(), parsed.content_type
        except OSError:
            return None

    return fetch
