"""Unit tests for the X-archive acquire adapter.

Runs against the committed synthetic archive (``tests/data/
synthetic_archive/``) — fully fake content (synthetic in-bounds coords, fake
handles), never real tweet data.
"""

from __future__ import annotations

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
    # The self-thread detection carries the head's media + the head permalink,
    # even though the coordinate lived in the reply.
    thread_det = next(d for d in detections if d.detected_from_url.endswith("/2001"))
    assert [m.remote_url for m in thread_det.media] == ["tweets_media/2001-BBB2.jpg"]


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
