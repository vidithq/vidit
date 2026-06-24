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

from .records import TweetRecord
from .syndication import ParsedMedia

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


def _archive_media(tweet: dict[str, Any], tweet_id: str) -> list[ParsedMedia]:
    """Map a tweet's inline media to archive-relative ``ParsedMedia``.

    ``remote_url`` carries the archive-relative path, not a URL: the export
    names a tweet's media file ``tweets_media/<tweet_id>-<basename>``, and the
    archive media fetcher reads it from disk. Images only for now — the export's
    video layout (separate mp4, thumbnail in ``media_url_https``) is a follow-up.
    """
    container = tweet.get("extended_entities") or tweet.get("entities") or {}
    entries = container.get("media") if isinstance(container, dict) else None
    if not isinstance(entries, list):
        return []
    out: list[ParsedMedia] = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("type") != "photo":
            continue
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
    return out


def read_tweets(archive_dir: Path, *, handle: str) -> list[TweetRecord]:
    """Parse ``tweets.js`` under ``archive_dir`` into ``TweetRecord``s.

    ``handle`` is the verified owner handle — the export is the owner's own
    tweets, so every record is stamped with it and the permalink derives from
    it. Records carry the inline reply edges, so ``stitch`` rebuilds real
    self-threads (unlike the single-tweet syndication path).
    """
    raw = (archive_dir / "tweets.js").read_text(encoding="utf-8")
    entries = _strip_ytd_prefix(raw)
    if not isinstance(entries, list):
        return []

    records: list[TweetRecord] = []
    for entry in entries:
        tweet = entry.get("tweet") if isinstance(entry, dict) else None
        if not isinstance(tweet, dict):
            continue
        tweet_id = tweet.get("id_str")
        if not isinstance(tweet_id, str) or not tweet_id:
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
            )
        )
    return records


def archive_media_fetcher(
    archive_dir: Path,
) -> Callable[[ParsedMedia], Awaitable[tuple[bytes, str] | None]]:
    """A media fetcher reading a record's media from ``tweets_media/`` on disk.

    Matches the assemble step's ``MediaFetcher`` signature. ``ParsedMedia.
    remote_url`` is the archive-relative path. Returns ``None`` for a missing
    file (the export referenced media it didn't include), so the detection
    persists media-incomplete rather than failing the whole backfill.
    """

    async def fetch(parsed: ParsedMedia) -> tuple[bytes, str] | None:
        try:
            return (archive_dir / parsed.remote_url).read_bytes(), parsed.content_type
        except OSError:
            return None

    return fetch
