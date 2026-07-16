"""Load typology fixtures and assemble them into records / a test archive.

Two consumers: the unit test builds a single ``TweetRecord`` (or a stitched
thread) per typology and resolves it; the archive test builds one consolidated
X export from the disk-only typologies and runs the real backfill over it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from app.services.tweet_ingest import read_tweets, record_from_syndication
from app.services.tweet_ingest.records import TweetRecord
from app.services.tweet_ingest.syndication import _cache_clear

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# A minimal, non-empty stand-in for an mp4's bytes. The ingest path stores
# videos without decoding them (``prepare_media`` passes non-image types
# through, ``validate_bytes`` only size-checks video/mp4), so any short byte
# string round-trips as a video Media row.
TINY_MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isomFAKE"

# Twitter's archive ``created_at`` format, for turning an ISO fixture timestamp
# into the raw export shape the archive reader parses.
_TWITTER_TIME_FMT = "%a %b %d %H:%M:%S %z %Y"


def typology_names() -> list[str]:
    """Every typology directory under ``fixtures/``, sorted for stable ids."""
    return sorted(p.name for p in FIXTURES_DIR.iterdir() if p.is_dir())


def load_body(typology: str) -> dict[str, Any]:
    return json.loads((FIXTURES_DIR / typology / "body.json").read_text(encoding="utf-8"))


def load_expected(typology: str) -> dict[str, Any]:
    return json.loads((FIXTURES_DIR / typology / "expected.json").read_text(encoding="utf-8"))


def load_chased(typology: str, tweet_id: str) -> dict[str, Any]:
    return json.loads(
        (FIXTURES_DIR / typology / f"chased_{tweet_id}.json").read_text(encoding="utf-8")
    )


def is_self_thread(body: dict[str, Any]) -> bool:
    """A ``self_thread`` fixture holds raw archive entries under ``thread``,
    not a single syndication body."""
    return "thread" in body


def owner_url(body: dict[str, Any]) -> str:
    handle = body["user"]["screen_name"]
    return f"https://x.com/{handle}/status/{body['id_str']}"


def record_from_body(body: dict[str, Any]) -> TweetRecord:
    """Build the geoloc tweet's ``TweetRecord`` from its syndication body.

    Fetches through a ``MockTransport`` client that returns ``body`` for the
    single syndication call ``record_from_syndication`` makes.
    """
    _cache_clear()
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _req: httpx.Response(200, json=body))
    )
    try:
        return record_from_syndication(owner_url(body), client=client)
    finally:
        client.close()


# The handle the unit-path ``self_thread`` archive is read under. The unit
# expected only pins the derived fields (coords, media roles, title), none of
# which depend on the handle, so any stable value works; the archive test reads
# under the real owner fixture's handle instead.
_UNIT_THREAD_HANDLE = "self_thread_owner"


def thread_from_self_thread(typology: str, tmp_path: Path) -> list[TweetRecord]:
    """The records for the ``self_thread`` typology, read from a throwaway archive.

    A self-thread only exists in an archive (the reply edge is inline), so this
    writes the fixture's raw entries into a ``tweets.js`` under ``tmp_path`` and
    reads them back. ``stitch`` is applied by the caller.
    """
    body = load_body(typology)
    archive = tmp_path / f"{typology}_archive"
    (archive / "tweets_media").mkdir(parents=True, exist_ok=True)
    write_archive_js(archive, list(body["thread"]))
    return read_tweets(archive, handle=_UNIT_THREAD_HANDLE)


# ── Archive assembly ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class ArchiveMediaFile:
    """One media file the consolidated archive must write to disk.

    ``relative_path`` is the ``tweets_media/<id>-<basename>`` path the archive
    reader will resolve; ``data`` is the synthetic bytes to write there.
    """

    relative_path: str
    data: bytes


def _iso_to_twitter(iso: str) -> str:
    """Render an ISO 8601 fixture timestamp in the archive's ``created_at`` form."""
    parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return parsed.strftime(_TWITTER_TIME_FMT)


def _photo_entry(url: str) -> dict[str, Any]:
    return {"type": "photo", "media_url_https": url}


def _video_entry(mp4_url: str) -> dict[str, Any]:
    return {
        "type": "video",
        "video_info": {
            "variants": [
                {"content_type": "application/x-mpegURL", "url": mp4_url + ".m3u8"},
                {"bitrate": "2176000", "content_type": "video/mp4", "url": mp4_url},
            ]
        },
    }


def _media_entries_from_syndication(
    details: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[tuple[str, bytes]]]:
    """Translate a syndication ``mediaDetails`` list into archive media entries.

    Returns the ``extended_entities.media`` entries plus, for each, the
    ``(media_url_basename, bytes)`` the archive reader will look for on disk.
    Photos keep their FAKE basename; videos map to the mp4 variant basename.
    """
    from tests._fixtures import TINY_JPEG

    entries: list[dict[str, Any]] = []
    files: list[tuple[str, bytes]] = []
    for detail in details:
        etype = detail.get("type")
        if etype == "photo":
            url = detail["media_url_https"]
            entries.append(_photo_entry(url))
            files.append((url.rsplit("/", 1)[-1], TINY_JPEG))
        elif etype in ("video", "animated_gif"):
            variants = detail.get("video_info", {}).get("variants", [])
            mp4 = next(
                (v["url"] for v in variants if v.get("content_type") == "video/mp4"),
                None,
            )
            if mp4 is None:
                continue
            entries.append(_video_entry(mp4))
            basename = mp4.rsplit("/", 1)[-1].split("?", 1)[0]
            files.append((basename, TINY_MP4))
    return entries, files


def archive_tweet_from_body(
    body: dict[str, Any],
) -> tuple[dict[str, Any], list[ArchiveMediaFile]]:
    """Convert a syndication-body fixture into one raw X-export tweet entry.

    Carries the OP text, timestamp, media, and any ``entities.urls`` source
    links through into the archive shape. Quote fixtures are not routed here
    (an archive quote needs an in-archive join or a chase, exercised separately);
    this covers the disk-only typologies.
    """
    tweet_id = body["id_str"]
    entry: dict[str, Any] = {
        "id_str": tweet_id,
        "created_at": _iso_to_twitter(body["created_at"]),
        "full_text": body.get("text", ""),
    }
    details = body.get("mediaDetails")
    files: list[ArchiveMediaFile] = []
    if isinstance(details, list) and details:
        media_entries, media_files = _media_entries_from_syndication(details)
        if media_entries:
            entry["extended_entities"] = {"media": media_entries}
        files = [
            ArchiveMediaFile(relative_path=f"tweets_media/{tweet_id}-{name}", data=data)
            for name, data in media_files
        ]
    entities = body.get("entities")
    if isinstance(entities, dict):
        entry["entities"] = entities
    return entry, files


def archive_tweet_from_thread_entry(
    entry: dict[str, Any],
) -> list[ArchiveMediaFile]:
    """The on-disk media files a raw ``self_thread`` archive entry references.

    The entry is already in export shape (it goes into ``tweets.js`` verbatim);
    this only enumerates the ``tweets_media/`` bytes it needs.
    """
    from tests._fixtures import TINY_JPEG

    tweet_id = entry["id_str"]
    container = entry.get("extended_entities") or entry.get("entities") or {}
    media = container.get("media") if isinstance(container, dict) else None
    files: list[ArchiveMediaFile] = []
    if not isinstance(media, list):
        return files
    for item in media:
        etype = item.get("type")
        if etype == "photo":
            basename = item["media_url_https"].rsplit("/", 1)[-1]
            files.append(
                ArchiveMediaFile(
                    relative_path=f"tweets_media/{tweet_id}-{basename}", data=TINY_JPEG
                )
            )
        elif etype in ("video", "animated_gif"):
            variants = item.get("video_info", {}).get("variants", [])
            mp4 = next(
                (v["url"] for v in variants if v.get("content_type") == "video/mp4"),
                None,
            )
            if mp4 is None:
                continue
            basename = mp4.rsplit("/", 1)[-1].split("?", 1)[0]
            files.append(
                ArchiveMediaFile(relative_path=f"tweets_media/{tweet_id}-{basename}", data=TINY_MP4)
            )
    return files


def write_archive_js(dest: Path, entries: list[dict[str, Any]]) -> None:
    """Write ``tweets.js`` under ``dest`` wrapping ``entries`` in the export shape.

    Each entry is a raw X-export tweet dict; the reader unwraps
    ``window.YTD.tweets.part0 = [{"tweet": ...}, ...]``.
    """
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps([{"tweet": e} for e in entries]),
        encoding="utf-8",
    )


def build_consolidated_archive(typologies: list[str], dest: Path) -> None:
    """Assemble the given typologies into one X export under ``dest``.

    Writes ``tweets.js`` (``window.YTD.tweets.part0 = [...]``) plus the
    ``tweets_media/`` byte files every entry references. Syndication-body
    typologies become one tweet each; a ``self_thread`` fixture expands into its
    raw entries so ``stitch`` rejoins them.
    """
    (dest / "tweets_media").mkdir(parents=True, exist_ok=True)
    tweets: list[dict[str, Any]] = []
    files: list[ArchiveMediaFile] = []
    for typology in typologies:
        body = load_body(typology)
        if is_self_thread(body):
            for entry in body["thread"]:
                tweets.append(entry)
                files.extend(archive_tweet_from_thread_entry(entry))
        else:
            entry, entry_files = archive_tweet_from_body(body)
            tweets.append(entry)
            files.extend(entry_files)
    write_archive_js(dest, tweets)
    for media_file in files:
        (dest / media_file.relative_path).write_bytes(media_file.data)
