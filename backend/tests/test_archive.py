"""Unit tests for the X-archive acquire adapter.

Runs against the committed synthetic archive (``tests/data/
synthetic_archive/``) — fully fake content (synthetic in-bounds coords, fake
handles), never real tweet data.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from app.services.tweet_ingest import (
    ParsedMedia,
    archive_media_fetcher,
    detect,
    read_tweets,
    stitch,
)

ARCHIVE = Path(__file__).parent / "data" / "synthetic_archive"


def test_read_tweets_parses_records():
    records = read_tweets(ARCHIVE, handle="ana")
    by_id = {r.tweet_id: r for r in records}
    assert set(by_id) == {"1001", "2001", "2002", "3001", "4001", "5001", "6001"}
    # Twitter created_at normalized to ISO 8601.
    assert by_id["1001"].created_at.startswith("2025-11-12")
    # Permalink derives from the verified handle, not the archive.
    assert by_id["1001"].permalink == "https://x.com/ana/status/1001"
    # Reply edges survive inline — what stitch needs and syndication can't give.
    assert by_id["2002"].in_reply_to_status_id == "2001"
    assert by_id["1001"].in_reply_to_status_id is None
    # Media reference is the archive-relative path.
    assert [m.remote_url for m in by_id["1001"].media] == ["tweets_media/1001-AAA1.jpg"]
    assert by_id["3001"].media == []


def test_stitch_and_detect_over_archive():
    records = read_tweets(ARCHIVE, handle="ana")
    detections = [d for thread in stitch(records) for d in detect(thread)]
    # 1001(1) + thread 2001/2002(1) + 3001 DMS(1) + 4001 hemi(1) + 5001(0)
    # + 6001 multi-coord(2) = 6.
    assert len(detections) == 6
    # The self-thread detection carries the head's media (as proof: the thread
    # declares no source) + the head permalink, even though the coordinate
    # lived in the reply.
    thread_det = next(d for d in detections if d.detected_from_url.endswith("/2001"))
    assert thread_det.source_url is None
    assert thread_det.source_media == []
    assert [m.remote_url for m in thread_det.proof_media] == ["tweets_media/2001-BBB2.jpg"]


async def test_archive_media_fetcher_reads_present_and_misses_absent():
    fetch = archive_media_fetcher(ARCHIVE)

    present = ParsedMedia(
        kind="image", remote_url="tweets_media/1001-AAA1.jpg", content_type="image/jpeg"
    )
    got = await fetch(present)
    assert got is not None
    data, content_type = got
    assert content_type == "image/jpeg" and len(data) > 0

    absent = ParsedMedia(
        kind="image", remote_url="tweets_media/nope.jpg", content_type="image/jpeg"
    )
    assert await fetch(absent) is None


def test_read_tweets_maps_video_media(tmp_path):
    """A ``video`` / ``animated_gif`` entry maps to the mp4 the export saved:
    ``tweets_media/<tweet_id>-<basename>``, basename from the highest-bitrate
    mp4 variant (query string stripped). An entry with no usable mp4 variant is
    dropped, not crashed on."""
    archive = tmp_path / "arc"
    archive.mkdir()
    payload = [
        {
            "tweet": {
                "id_str": "7001",
                "full_text": "clip",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "extended_entities": {
                    "media": [
                        {
                            "type": "video",
                            "media_url_https": "https://pbs.twimg.com/ext_tw_video_thumb/7/img/T.jpg",
                            "video_info": {
                                "variants": [
                                    {
                                        "content_type": "application/x-mpegURL",
                                        "url": "https://video.twimg.com/ext_tw_video/7/pl/PLAYLIST.m3u8",
                                    },
                                    {
                                        "bitrate": "632000",
                                        "content_type": "video/mp4",
                                        "url": "https://video.twimg.com/ext_tw_video/7/vid/320x568/LOW.mp4?tag=12",
                                    },
                                    {
                                        "bitrate": "2176000",
                                        "content_type": "video/mp4",
                                        "url": "https://video.twimg.com/ext_tw_video/7/vid/720x1280/HIGH.mp4?tag=12",
                                    },
                                ]
                            },
                        },
                        {
                            "type": "animated_gif",
                            "video_info": {
                                "variants": [
                                    {
                                        "bitrate": 0,
                                        "content_type": "video/mp4",
                                        "url": "https://video.twimg.com/tweet_video/GIF.mp4",
                                    }
                                ]
                            },
                        },
                        {"type": "video", "video_info": {"variants": []}},
                    ]
                },
            }
        }
    ]
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps(payload), encoding="utf-8"
    )
    [record] = read_tweets(archive, handle="ana")
    assert [(m.kind, m.remote_url, m.content_type) for m in record.media] == [
        ("video", "tweets_media/7001-HIGH.mp4", "video/mp4"),
        ("video", "tweets_media/7001-GIF.mp4", "video/mp4"),
    ]


def test_read_tweets_skips_non_numeric_id(tmp_path):
    """A crafted ``id_str`` carrying path metacharacters is dropped, so it never
    reaches the ``tweets_media/<id>-...`` path built from it."""
    archive = tmp_path / "arc"
    archive.mkdir()
    payload = [
        {"tweet": {"id_str": "12345", "full_text": "a", "created_at": ""}},
        {"tweet": {"id_str": "../../../../etc/passwd", "full_text": "b", "created_at": ""}},
    ]
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps(payload), encoding="utf-8"
    )
    records = read_tweets(archive, handle="ana")
    assert [r.tweet_id for r in records] == ["12345"]


def test_self_reference_link_excluded_last_third_party_status_wins(tmp_path, monkeypatch):
    """Regression (the "previous geolocation" tower tweets): the geoloc tweet's
    entities.urls carries, in order, the analyst's own earlier status (a
    cross-reference, in the archive itself), a profile link (no ``/status/``),
    then the third-party status that is the actual quote. The own-status id is
    excluded via ``by_id`` (the archive's own tweets); among what's left, the
    single remaining status candidate is chased as the source, not the
    self-reference."""
    import app.services.tweet_ingest.acquire as acquire_mod

    archive = tmp_path / "arc"
    archive.mkdir()
    payload = [
        {
            "tweet": {
                "id_str": "111",
                "created_at": "Wed Nov 12 10:00:00 +0000 2025",
                "full_text": "Previous geolocation here",
            }
        },
        {
            "tweet": {
                "id_str": "222",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": (
                    "Seems the same site was struck again. Previous geolocation "
                    "here: https://x.com/analyst/status/111 | C: 26.564389, "
                    "57.087644 | S: https://x.com/CENTCOM "
                    "https://x.com/CENTCOM/status/999"
                ),
                "entities": {
                    "urls": [
                        {
                            "url": "https://t.co/prev",
                            "expanded_url": "https://x.com/analyst/status/111",
                        },
                        {"url": "https://t.co/profile", "expanded_url": "https://x.com/CENTCOM"},
                        {
                            "url": "https://t.co/status",
                            "expanded_url": "https://x.com/CENTCOM/status/999",
                        },
                    ]
                },
            }
        },
    ]
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps(payload), encoding="utf-8"
    )

    def fake_fetch(tweet_id, *, client=None):
        assert tweet_id == "999"  # never chases the self-reference (111)
        return {
            "user": {"screen_name": "CENTCOM"},
            "text": "footage",
            "created_at": "2025-11-12T09:00:00.000Z",
        }

    monkeypatch.setattr(acquire_mod, "fetch_syndication", fake_fetch)
    records = read_tweets(archive, handle="analyst", chase=True)
    geoloc = next(r for r in records if r.tweet_id == "222")
    assert geoloc.quoted is not None
    assert geoloc.quoted.tweet_id == "999"
    assert geoloc.quoted.handle == "CENTCOM"


def test_several_third_party_status_links_are_ambiguous_no_chase(tmp_path, monkeypatch):
    """Two distinct third-party status links, neither in the archive: the source
    is ambiguous, so nothing is chased and the record carries no source tweet
    (the source stays empty for review); the same id linked twice remains one
    candidate and is chased."""
    import app.services.tweet_ingest.acquire as acquire_mod

    archive = tmp_path / "arc"
    archive.mkdir()
    payload = [
        {
            "tweet": {
                "id_str": "1",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": (
                    "See also https://x.com/other/status/777 Source: https://x.com/other/status/888"
                ),
                "entities": {
                    "urls": [
                        {
                            "url": "https://t.co/a",
                            "expanded_url": "https://x.com/other/status/777",
                        },
                        {
                            "url": "https://t.co/b",
                            "expanded_url": "https://x.com/other/status/888",
                        },
                    ]
                },
            }
        },
        {
            "tweet": {
                "id_str": "2",
                "created_at": "Wed Nov 12 15:00:00 +0000 2025",
                "full_text": "Source: https://x.com/other/status/888 (again: same link)",
                "entities": {
                    "urls": [
                        {
                            "url": "https://t.co/c",
                            "expanded_url": "https://x.com/other/status/888",
                        },
                        {
                            "url": "https://t.co/d",
                            "expanded_url": "https://x.com/other/status/888",
                        },
                    ]
                },
            }
        },
    ]
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps(payload), encoding="utf-8"
    )

    seen_ids: list[str] = []

    def fake_fetch(tweet_id, *, client=None):
        seen_ids.append(tweet_id)
        return {
            "user": {"screen_name": "other"},
            "text": "footage",
            "created_at": "2025-11-12T09:00:00.000Z",
        }

    monkeypatch.setattr(acquire_mod, "fetch_syndication", fake_fetch)
    records = read_tweets(archive, handle="ana", chase=True)
    ambiguous = next(r for r in records if r.tweet_id == "1")
    assert ambiguous.quoted is None
    deduped = next(r for r in records if r.tweet_id == "2")
    assert deduped.quoted is not None
    assert deduped.quoted.tweet_id == "888"
    assert seen_ids == ["888"]  # only the deduped sole candidate was chased


def test_embedded_x_status_in_foreign_host_is_not_chased(tmp_path, monkeypatch):
    """Host gate: a non-X URL (an archive.org capture, a common OSINT citation)
    that merely carries ``x.com/<w>/status/<id>`` inside its path is not an X
    status link, so it is never chased. The candidate rule keys on the real host
    via ``classify_source_host``, not a raw substring match on the whole URL."""
    import app.services.tweet_ingest.acquire as acquire_mod

    archive = tmp_path / "arc"
    archive.mkdir()
    payload = [
        {
            "tweet": {
                "id_str": "1",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": "Cited https://t.co/fakearchive",
                "entities": {
                    "urls": [
                        {
                            "url": "https://t.co/fakearchive",
                            "expanded_url": (
                                "https://web.archive.org/web/20240101000000/"
                                "https://x.com/u/status/123"
                            ),
                        }
                    ]
                },
            }
        }
    ]
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps(payload), encoding="utf-8"
    )

    def fake_fetch(tweet_id, *, client=None):
        raise AssertionError("a non-X host must never be chased")

    monkeypatch.setattr(acquire_mod, "fetch_syndication", fake_fetch)
    [record] = read_tweets(archive, handle="ana", chase=True)
    assert record.quoted is None


def test_x_status_plus_telegram_link_is_ambiguous_no_chase(tmp_path, monkeypatch):
    """A tweet linking BOTH an X status and a Telegram post is ambiguous at
    resolve (two footage candidates across hosts), so neither is chased: the X
    status must not materialise as a quote and win precedence over the empty
    resolved source."""
    import app.services.tweet_ingest.acquire as acquire_mod
    import app.services.tweet_ingest.archive as archive_mod

    archive = tmp_path / "arc"
    archive.mkdir()
    payload = [
        {
            "tweet": {
                "id_str": "1",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": "Source: https://x.com/src/status/999 also https://t.me/chan/42",
                "entities": {
                    "urls": [
                        {"url": "https://t.co/x", "expanded_url": "https://x.com/src/status/999"},
                        {"url": "https://t.co/tg", "expanded_url": "https://t.me/chan/42"},
                    ]
                },
            }
        }
    ]
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps(payload), encoding="utf-8"
    )

    def fake_fetch(tweet_id, *, client=None):
        raise AssertionError("ambiguous source must not chase the X status")

    def fake_embed(url, *, client=None):
        raise AssertionError("ambiguous source must not chase the Telegram post")

    monkeypatch.setattr(acquire_mod, "fetch_syndication", fake_fetch)
    monkeypatch.setattr(archive_mod, "fetch_telegram_embed", fake_embed)
    [record] = read_tweets(archive, handle="ana", chase=True)
    assert record.quoted is None
    assert record.telegram is None


def test_handleless_own_status_link_chased_then_thrown(tmp_path, monkeypatch):
    """A link to the owner's OWN status in the handle-less ``i/web/status`` form,
    absent from the export (deleted / truncated), slips both the ``by_id`` and the
    URL-handle exclusions. Once chased, the syndication handle reveals it as the
    owner's own post, so the result is thrown out rather than materialised as
    third-party footage."""
    import app.services.tweet_ingest.acquire as acquire_mod

    archive = tmp_path / "arc"
    archive.mkdir()
    payload = [
        {
            "tweet": {
                "id_str": "1",
                "created_at": "Wed Nov 12 14:33:00 +0000 2025",
                "full_text": "Reposting my earlier one https://t.co/self",
                "entities": {
                    "urls": [
                        {
                            "url": "https://t.co/self",
                            "expanded_url": "https://x.com/i/web/status/999",
                        }
                    ]
                },
            }
        }
    ]
    (archive / "tweets.js").write_text(
        "window.YTD.tweets.part0 = " + json.dumps(payload), encoding="utf-8"
    )

    def fake_fetch(tweet_id, *, client=None):
        assert tweet_id == "999"
        return {
            "user": {"screen_name": "Analyst"},  # the owner's handle, different case
            "text": "my own footage",
            "created_at": "2025-11-12T09:00:00.000Z",
        }

    monkeypatch.setattr(acquire_mod, "fetch_syndication", fake_fetch)
    [record] = read_tweets(archive, handle="analyst", chase=True)
    assert record.quoted is None


def _cdn_client_factory(handler):
    """An ``httpx.AsyncClient`` factory backed by a ``MockTransport`` handler, for
    monkeypatching ``httpx.AsyncClient`` so ``fetch_cdn_media`` never leaves the
    box."""
    real = httpx.AsyncClient

    def make_client(**_kwargs):
        return real(transport=httpx.MockTransport(handler))

    return make_client


async def test_fetch_cdn_media_caps_oversized_stream(monkeypatch):
    """A CDN response larger than the shared byte cap is dropped fail-soft
    (media-incomplete), not buffered unbounded into memory."""
    import app.services.tweet_ingest.archive as archive_mod

    monkeypatch.setattr(archive_mod, "MEDIA_FETCH_MAX_BYTES", 16)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _cdn_client_factory(lambda _req: httpx.Response(200, content=b"x" * 64)),
    )
    parsed = ParsedMedia(
        kind="video", remote_url="https://video.twimg.com/big.mp4", content_type="video/mp4"
    )
    assert await archive_mod.fetch_cdn_media(parsed) is None


async def test_fetch_cdn_media_returns_within_cap(monkeypatch):
    """A CDN response within the cap streams back intact."""
    import app.services.tweet_ingest.archive as archive_mod

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        _cdn_client_factory(lambda _req: httpx.Response(200, content=b"tiny-mp4-bytes")),
    )
    parsed = ParsedMedia(
        kind="video", remote_url="https://video.twimg.com/ok.mp4", content_type="video/mp4"
    )
    assert await archive_mod.fetch_cdn_media(parsed) == (b"tiny-mp4-bytes", "video/mp4")


async def test_archive_media_fetcher_rejects_path_traversal(tmp_path):
    """The fetcher never reads outside the extraction dir, even when a record's
    ``remote_url`` resolves to a real sibling file (defeats arbitrary-file read)."""
    archive = tmp_path / "arc"
    (archive / "tweets_media").mkdir(parents=True)
    # A real file just outside the archive dir, reachable only by escaping it.
    (tmp_path / "secret.png").write_bytes(b"\x89PNG not yours")
    fetch = archive_media_fetcher(archive)
    escaping = ParsedMedia(
        kind="image",
        remote_url="tweets_media/../../secret.png",
        content_type="image/png",
    )
    assert await fetch(escaping) is None
