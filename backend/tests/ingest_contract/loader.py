"""Load typology fixtures and assemble them into records / a test archive.

A typology ships ``body.json`` (syndication shape, or raw archive entries under ``thread``
for archive-only shapes), ``expected.json``, and any further body the acquisition reads:
``parent_<id>.json`` (reply parent), ``chased_<id>.json`` (linked status), ``embed.html``
(linked Telegram post). :func:`syndication_client` serves them and 404s everything else,
so every path runs offline.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from app.services.tweet_ingest import Resolution, acquire_thread, read_tweets, stitch
from app.services.tweet_ingest.records import TweetRecord
from app.services.tweet_ingest.syndication import _cache_clear
from app.services.tweet_ingest.urls import TELEGRAM_HOST_RE
from tests._fixtures import TINY_MP4, write_archive_js

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# The one entry that reads the engine's second exit, so the only path asserting ``expected["request"]``.
_REQUEST_PATH = "bot"

# Twitter's archive ``created_at`` format.
_TWITTER_TIME_FMT = "%a %b %d %H:%M:%S %z %Y"


def typology_names() -> list[str]:
    return sorted(p.name for p in FIXTURES_DIR.iterdir() if p.is_dir())


def load_body(typology: str) -> dict[str, Any]:
    return json.loads((FIXTURES_DIR / typology / "body.json").read_text(encoding="utf-8"))


def load_expected(typology: str) -> dict[str, Any]:
    return json.loads((FIXTURES_DIR / typology / "expected.json").read_text(encoding="utf-8"))


def load_embed(typology: str) -> str | None:
    """The Telegram embed the typology ships, or ``None``.

    Also read by ``tests/test_bot.py`` so the bot's Telegram payload and the catalogue's cannot drift.
    """
    embed = FIXTURES_DIR / typology / "embed.html"
    return embed.read_text(encoding="utf-8") if embed.is_file() else None


def typologies_for_path(path: str) -> list[str]:
    """Every typology one entry path runs.

    A typology is in unless its ``expected.json`` carries ``paths.<path>.skip`` with a
    reason, so a newly added typology enters every entry's run by default.
    """
    return [
        typology
        for typology in typology_names()
        if "skip" not in load_expected(typology).get("paths", {}).get(path, {})
    ]


def load_chased(typology: str, tweet_id: str) -> dict[str, Any]:
    return json.loads(
        (FIXTURES_DIR / typology / f"chased_{tweet_id}.json").read_text(encoding="utf-8")
    )


def expected_for_path(typology: str, path: str) -> dict[str, Any]:
    """``expected.json`` as one entry path sees it.

    The shared top level is the whole answer; a ``paths.<path>`` block holds only that
    entry's own vocabulary (the bot's failure reason) or a ``skip``.
    """
    expected = load_expected(typology)
    overrides = expected.get("paths", {}).get(path, {})
    return {**expected, **overrides}


def assert_resolution_matches(typology: str, path: str, resolution: Resolution) -> None:
    """Assert one entry's resolution answers the typology's expectation.

    One detection per coordinate, each carrying the title, source, mirrors, warnings and
    media split the expectation names. ``paths.<path>.reason`` pins that entry's refusal.

    An ``expected["request"]`` block pins the second exit (the draft a coordinate-less
    thread yields); a typology without one must yield none. Only the bot asks for the exit
    (``with_requests=True``), so every other entry resolves none.
    """
    block = load_expected(typology).get("paths", {}).get(path, {})
    expected = expected_for_path(typology, path)

    assert len(resolution.detections) == len(expected["coords"]), typology
    if "reason" in block:
        assert resolution.reason == block["reason"], typology
    request = expected.get("request") if path == _REQUEST_PATH else None
    if request is None:
        assert resolution.requests == [], typology
    else:
        [draft] = resolution.requests
        assert draft.source_url == request["source_url"], typology
        assert draft.title == request["title"], typology
        footage = draft.footage_candidates[0]
        assert [footage.kind, footage.origin] == list(request["footage"]), typology
    for detection in resolution.detections:
        assert detection.title == expected["title"], typology
        assert detection.source_url == expected["source_url"], typology
        assert detection.secondary_source_urls == expected["secondary_source_urls"], typology
        assert detection.warnings == expected["warnings"], typology
        assert [[m.kind, m.origin] for m in detection.source_media] == [
            list(pair) for pair in expected["source_media"]
        ], typology
        assert [[m.kind, m.origin] for m in detection.proof_media] == [
            list(pair) for pair in expected["proof_media"]
        ], typology


def is_self_thread(body: dict[str, Any]) -> bool:
    """A ``self_thread`` fixture holds raw archive entries under ``thread``, not one syndication body."""
    return "thread" in body


def owner_url(body: dict[str, Any]) -> str:
    handle = body["user"]["screen_name"]
    return f"https://x.com/{handle}/status/{body['id_str']}"


def load_bodies(typology: str) -> dict[str, dict[str, Any]]:
    """Every syndication body the typology ships, keyed by tweet id (``body.json``, ``parent_<id>.json``, ``chased_<id>.json``)."""
    bodies: dict[str, dict[str, Any]] = {}
    body = load_body(typology)
    if not is_self_thread(body):
        bodies[body["id_str"]] = body
    for path in sorted((FIXTURES_DIR / typology).glob("*.json")):
        if path.name in ("body.json", "expected.json"):
            continue
        extra = json.loads(path.read_text(encoding="utf-8"))
        bodies[extra["id_str"]] = extra
    return bodies


def syndication_client(typology: str) -> httpx.Client:
    """A transport serving the typology's bodies and embed, 404 elsewhere.

    An ``x.com`` read answers from the bodies, a ``t.me`` read from ``embed.html``. A 404
    is X's answer for an invisible post, so an out-of-fixture chase fails soft offline.
    The fetch cache is cleared first so another typology's body cannot answer here.
    """
    bodies = load_bodies(typology)
    embed = load_embed(typology)
    _cache_clear()

    def handler(request: httpx.Request) -> httpx.Response:
        if TELEGRAM_HOST_RE.match(request.url.host.lower()) is not None:
            if embed is None:
                return httpx.Response(404)
            return httpx.Response(200, text=embed)
        body = bodies.get(request.url.params.get("id", ""))
        return httpx.Response(200, json=body) if body is not None else httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def thread_for(typology: str, tmp_path: Path) -> list[TweetRecord]:
    """The typology's thread as the live acquisition reads it (``acquire_thread``, or the throwaway archive for archive-only shapes)."""
    body = load_body(typology)
    if is_self_thread(body):
        threads = stitch(thread_from_self_thread(typology, tmp_path))
        assert len(threads) == 1, f"{typology}: expected one stitched thread"
        return threads[0]
    with syndication_client(typology) as client:
        return acquire_thread(
            body["id_str"], handle=body["user"]["screen_name"], client=client
        ).records


# Handle the unit-path ``self_thread`` archive is read under; the expected fields do not depend on it.
_UNIT_THREAD_HANDLE = "self_thread_owner"


def thread_from_self_thread(typology: str, tmp_path: Path) -> list[TweetRecord]:
    """Records for the ``self_thread`` typology, read from a throwaway ``tweets.js`` (a self-thread only exists in an archive). ``stitch`` is the caller's."""
    body = load_body(typology)
    archive = tmp_path / f"{typology}_archive"
    (archive / "tweets_media").mkdir(parents=True, exist_ok=True)
    write_archive_js(archive, list(body["thread"]))
    return read_tweets(archive, handle=_UNIT_THREAD_HANDLE)


@dataclass(frozen=True)
class ArchiveMediaFile:
    """One media file the consolidated archive writes: ``relative_path`` (``tweets_media/<id>-<basename>``) and its synthetic ``data``."""

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
    """Translate a syndication ``mediaDetails`` list into archive media entries plus the ``(basename, bytes)`` pairs the reader finds on disk.

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

    Quote fixtures are not routed here (an archive quote needs a join or a chase, tested separately).
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
    """The ``tweets_media/`` files a raw ``self_thread`` entry (already in export shape) references."""
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


def build_consolidated_archive(typologies: list[str], dest: Path) -> None:
    """Assemble the given typologies into one X export under ``dest`` (``tweets.js`` plus media files).

    A ``self_thread`` fixture expands into its raw entries so ``stitch`` rejoins them.
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
