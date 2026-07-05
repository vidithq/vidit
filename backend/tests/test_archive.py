"""Unit tests for the X-archive acquire adapter.

Runs against the committed synthetic archive (``tests/data/
synthetic_archive/``) — fully fake content (synthetic in-bounds coords, fake
handles), never real tweet data.
"""

from __future__ import annotations

import json
from pathlib import Path

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
