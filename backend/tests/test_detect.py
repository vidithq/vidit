"""Unit tests for ``detect_diagnosed``: a thread becomes 0..N ``DetectedGeoloc``
DTOs, plus the reason when it becomes none.

Pure, no DB. Mirrors the extractor-level coverage in ``test_tweet_parsing.py``
but at the thread to DTO boundary. What a draft still needs from its owner
(the warnings) and why a thread produced none (the reason) are pinned here too:
they are the engine's answer, and every entry surfaces the same one.
"""

from __future__ import annotations

import dataclasses
from datetime import date

import pytest

from app.services.tweet_ingest import (
    COORDS_INVALID,
    COORDS_MISSING,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_MISSING,
    DetectedGeoloc,
    ParsedMedia,
    TweetRecord,
    detect_diagnosed,
    stitch,
)
from app.services.tweet_ingest.records import QuotedTweet, SourceLink


def _detected(thread: list[TweetRecord]) -> list[DetectedGeoloc]:
    """The DTOs alone, for the cases asserting on fields rather than on the
    refusal reason ``detect_diagnosed`` returns beside them."""
    return detect_diagnosed(thread)[0]


def _rec(
    tweet_id: str,
    text: str,
    *,
    created_at: str = "2025-11-12T14:33:00Z",
    handle: str = "analyst",
    media: list[ParsedMedia] | None = None,
    links: list[SourceLink] | None = None,
    quoted: QuotedTweet | None = None,
) -> TweetRecord:
    return TweetRecord(
        tweet_id=tweet_id,
        handle=handle,
        text=text,
        created_at=created_at,
        media=media or [],
        external_sources=links or [],
        quoted=quoted,
    )


def test_no_coordinate_yields_empty_list():
    assert _detected([_rec("1", "Just some commentary, no coords")]) == []


def test_empty_thread_yields_empty_list():
    assert _detected([]) == []


def test_single_coordinate_emits_one_detection():
    out = _detected([_rec("1", "Strike at 48.012345, 37.802411 in Donetsk")])
    assert len(out) == 1
    d = out[0]
    assert d.coordinate.lat == pytest.approx(48.012345)
    assert d.coordinate.lng == pytest.approx(37.802411)
    assert d.owner_handle == "analyst"
    assert d.detected_from_tweet_id == 1
    assert d.detected_from_url == "https://x.com/analyst/status/1"
    assert d.event_date == date(2025, 11, 12)
    # A referenceless annotation declares no source: both slots stay empty
    # rather than deducing the tweet's own URL / date.
    assert d.source_url is None
    assert d.source_posted_at is None


def test_the_provenance_url_is_built_from_the_id_whatever_case_the_handle_carried():
    # The id is the identity; the URL is written from it at the exit, so a
    # handle spelled two ways in one export cannot split one post in two.
    lower = _detected([_rec("1", "48.012345, 37.802411", handle="analyst")])[0]
    upper = _detected([_rec("1", "48.012345, 37.802411", handle="Analyst")])[0]
    assert lower.detected_from_tweet_id == upper.detected_from_tweet_id == 1
    assert upper.detected_from_url == "https://x.com/Analyst/status/1"


def test_multiple_coordinates_emit_one_detection_each():
    out = _detected([_rec("1", "Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert len(out) == 2


def test_coordinate_in_reply_keeps_the_head_as_provenance():
    # Head carries the video, the reply carries the coordinate: one detection
    # with the head's own post as provenance. The thread declares no source, so
    # source_url stays empty; the video fills the otherwise empty source media
    # slot, where the proof document (images only) would have dropped it.
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
    out = _detected([head, reply])
    assert len(out) == 1
    assert out[0].detected_from_tweet_id == 1
    assert out[0].detected_from_url == "https://x.com/analyst/status/1"
    assert out[0].source_url is None
    assert [m.remote_url for m in out[0].source_media] == ["https://video.twimg.com/x.mp4"]
    assert out[0].proof_media == []


def test_proof_keeps_the_text_and_drops_the_media_wrapper():
    out = _detected([_rec("1", "Strike here 48.012345, 37.802411 https://t.co/abc123")])
    assert len(out) == 1
    # The coordinate line stays: the analyst edits the proof at review, and the
    # structured field is not a reason to rewrite what they wrote.
    assert out[0].proof_text == "Strike here 48.012345, 37.802411"


def test_title_is_never_a_bare_coordinate():
    out = _detected([_rec("1", "48.012345, 37.802411")])
    assert len(out) == 1
    # The only line is a coordinate alone, so no line qualifies and the analyst
    # types the title at review.
    assert out[0].title == ""


def test_title_keeps_the_line_as_written():
    out = _detected([_rec("1", "#Ukraine strike at 48.012345, 37.802411 https://t.co/x")])
    assert out[0].title == "#Ukraine strike at 48.012345, 37.802411 https://t.co/x"


def test_malformed_time_recovers_date_and_nulls_detected_post_at():
    # A valid date with a garbled time-of-day: event_date is recovered from the
    # date prefix; detected_post_at is NULL, not a false 1970, and the source
    # slots stay empty (no source declared, no fabricated date).
    out = _detected([_rec("1", "Strike 48.012345, 37.802411", created_at="2025-11-12T99:99:99Z")])
    assert len(out) == 1
    d = out[0]
    assert d.event_date == date(2025, 11, 12)
    assert d.source_posted_at is None
    assert d.detected_post_at is None


def test_fully_unparseable_timestamp_yields_no_dates():
    # Nothing recoverable: every date stays NULL rather than a fabricated epoch.
    out = _detected([_rec("1", "Strike 48.012345, 37.802411", created_at="not-a-timestamp")])
    assert len(out) == 1
    d = out[0]
    assert d.event_date is None
    assert d.source_posted_at is None
    assert d.detected_post_at is None


# ── Warnings and refusals: what every entry surfaces ──────────────────────


def test_a_sourceless_draft_warns_source_missing():
    [dto] = _detected([_rec("1", "Geolocated 48.012345, 37.802411 near the bridge")])
    assert dto.warnings == [SOURCE_MISSING]


def test_several_candidate_links_warn_source_ambiguous():
    [dto] = _detected(
        [
            _rec(
                "1",
                "Geolocated 48.012345, 37.802411",
                links=[
                    SourceLink(url="https://t.me/chan/1"),
                    SourceLink(url="https://youtu.be/xyz"),
                ],
            )
        ]
    )
    assert dto.warnings == [SOURCE_AMBIGUOUS]
    assert dto.source_url is None
    assert dto.secondary_source_urls == ["https://t.me/chan/1", "https://youtu.be/xyz"]


def test_several_coordinates_warn_on_every_draft():
    out = _detected([_rec("1", "Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert len(out) == 2
    assert all(dto.warnings == [SEVERAL_COORDINATES, SOURCE_MISSING] for dto in out)


def test_a_sourced_draft_warns_nothing():
    quoted = QuotedTweet(tweet_id="2", handle="src", text="", created_at="")
    [dto] = _detected([_rec("1", "Geolocated 48.012345, 37.802411", quoted=quoted)])
    assert dto.warnings == []


def test_no_coordinate_is_diagnosed_as_missing():
    assert detect_diagnosed([_rec("1", "Just commentary")]) == ([], COORDS_MISSING)


def test_an_out_of_bounds_coordinate_is_diagnosed_as_invalid():
    detections, reason = detect_diagnosed([_rec("1", "at 991.123456, 37.802411")])
    assert detections == []
    assert reason == COORDS_INVALID


def test_a_draft_carries_no_reason():
    detections, reason = detect_diagnosed([_rec("1", "Geolocated 48.012345, 37.802411")])
    assert len(detections) == 1
    assert reason is None


def test_a_retweet_produces_nothing():
    # The prefix means the words are someone else's, on every entry.
    assert _detected([_rec("1", "RT @front_cam: Geolocated 48.012345, 37.802411")]) == []


# ── Archive regression: the shared spine over a stitched thread ────────────


def test_archive_free_text_thread_detection_unchanged():
    # The archive backfill spine (stitch then detect): a coordinate in the head
    # and commentary in the reply land as one detection with combined proof.
    head = _rec("1", "Geolocated 48.012345, 37.802411 near the bridge")
    reply = _rec("2", "More context on the strike", created_at="2025-11-12T14:40:00Z")
    reply = dataclasses.replace(reply, in_reply_to_status_id="1")
    threads = stitch([head, reply])
    out = [d for thread in threads for d in _detected(thread)]
    assert len(out) == 1
    d = out[0]
    assert d.coordinate.lat == pytest.approx(48.012345)
    assert d.detected_from_url == "https://x.com/analyst/status/1"
    assert "near the bridge" in d.proof_text
    assert "More context on the strike" in d.proof_text
