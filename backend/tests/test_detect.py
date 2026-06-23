"""Unit tests for ``detect`` — a thread becomes 0..N ``DetectedGeoloc`` DTOs.

Pure, no DB. Mirrors the extractor-level coverage in ``test_tweet_parsing.py``
but at the thread → DTO boundary.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.services.tweet_ingest import ParsedMedia, TweetRecord, detect


def _rec(
    tweet_id: str,
    text: str,
    *,
    created_at: str = "2025-11-12T14:33:00Z",
    handle: str = "analyst",
    media: list[ParsedMedia] | None = None,
) -> TweetRecord:
    return TweetRecord(
        tweet_id=tweet_id,
        handle=handle,
        text=text,
        created_at=created_at,
        permalink=f"https://x.com/{handle}/status/{tweet_id}",
        media=media or [],
    )


def test_no_coordinate_yields_empty_list():
    assert detect([_rec("1", "Just some commentary, no coords")]) == []


def test_empty_thread_yields_empty_list():
    assert detect([]) == []


def test_single_coordinate_emits_one_detection():
    out = detect([_rec("1", "Strike at 48.012345, 37.802411 in Donetsk")])
    assert len(out) == 1
    d = out[0]
    assert d.coordinate.lat == pytest.approx(48.012345)
    assert d.coordinate.lng == pytest.approx(37.802411)
    assert d.owner_handle == "analyst"
    assert d.detected_from_url == "https://x.com/analyst/status/1"
    assert d.event_date == date(2025, 11, 12)


def test_multiple_coordinates_emit_one_detection_each():
    out = detect([_rec("1", "Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert len(out) == 2


def test_coordinate_in_reply_pairs_with_head_media():
    # Head carries the footage, the reply carries the coordinate — one detection
    # with the head's media and the head's permalink as provenance.
    head = _rec(
        "1",
        "Footage from Bakhmut",
        media=[
            ParsedMedia(
                kind="video", remote_url="https://video.twimg.com/x.mp4", content_type="video/mp4"
            )
        ],
    )
    reply = _rec("2", "Geolocated: 48.592153, 38.002480", created_at="2025-11-12T14:40:00Z")
    out = detect([head, reply])
    assert len(out) == 1
    assert out[0].detected_from_url == "https://x.com/analyst/status/1"
    assert [m.remote_url for m in out[0].media] == ["https://video.twimg.com/x.mp4"]


def test_proof_text_strips_coordinates_and_shortlinks():
    out = detect([_rec("1", "Strike here 48.012345, 37.802411 https://t.co/abc123")])
    assert len(out) == 1
    proof = out[0].proof_text
    assert "48.012345" not in proof
    assert "t.co" not in proof
    assert "Strike here" in proof


def test_title_is_never_a_bare_coordinate():
    out = detect([_rec("1", "48.012345, 37.802411")])
    assert len(out) == 1
    # The only line is a bare coordinate → title falls back to empty.
    assert out[0].title == ""
