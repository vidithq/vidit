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

from .extract import is_retweet
from .records import ParsedMedia, QuotedTweet, SourceLink, TweetRecord
from .syndication import extract_source_links, media_entry
from .urls import is_trusted_media_url

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
    """Normalize Twitter's ``created_at`` to ISO 8601, the form a record carries.

    Falls back to the raw value if it's already ISO or otherwise unparseable:
    the resolution degrades to the epoch date rather than raising.
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


def _archive_media(tweet: dict[str, Any], tweet_id: str) -> list[ParsedMedia]:
    """Map a tweet's inline media to archive-relative ``ParsedMedia``.

    ``remote_url`` carries the archive-relative path, not a URL: the export
    downloads each media beside ``tweets.js`` as
    ``tweets_media/<tweet_id>-<basename>``, where the basename is the last path
    segment of the URL the entry declares (``syndication.media_entry``, the one
    reader of a media entry, which picks a video's highest-bitrate mp4 variant,
    the one the export saved). The basename names the file and nothing else: an
    imported photo's stored type is a constant
    (``records.PHOTO_CONTENT_TYPE``), so a file the entry's extension describes
    badly costs nothing, and a basename that names no saved file degrades to a
    fetch that comes back empty, never a failure.
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
    """The quoted post ``quoted_id`` names, joined inside the export itself.

    Pure disk: both posts are in the same file, so the owner quoting their own
    post needs no fetch. A quote the export does not hold stays unresolved on
    the record (``TweetRecord.quoted_status_id``), which is the one target
    ``chase.chase_thread`` reads it for.
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
    )


def read_tweets(archive_dir: Path, *, handle: str) -> list[TweetRecord]:
    """Parse ``tweets.js`` under ``archive_dir`` into enriched ``TweetRecord``s.

    ``handle`` is the verified owner handle; the export is the owner's own
    tweets. Each record carries the inline reply edges (so ``stitch`` rebuilds
    real self-threads), the OP media, the links it carries (``entities.urls``)
    and the quoted post joined inside the export. Pure disk: the footage a
    thread points at off the export is ``chase.chase_thread``'s one fetch, run
    on the stitched threads.

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
