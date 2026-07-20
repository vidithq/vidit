"""Unit tests for ``detect`` — a thread becomes 0..N ``DetectedGeoloc`` DTOs.

Pure, no DB. Mirrors the extractor-level coverage in ``test_tweet_parsing.py``
but at the thread → DTO boundary.
"""

from __future__ import annotations

import dataclasses
from datetime import date

import httpx
import pytest

from app.services.tweet_ingest import (
    ParsedMedia,
    TweetRecord,
    detect,
    detect_structured,
    stitch,
)
from app.services.tweet_ingest.records import QuotedTweet, SourceLink


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
    # A referenceless annotation declares no source: both slots stay empty
    # rather than deducing the tweet's own permalink / date.
    assert d.source_url is None
    assert d.source_posted_at is None


def test_multiple_coordinates_emit_one_detection_each():
    out = detect([_rec("1", "Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert len(out) == 2


def test_coordinate_in_reply_keeps_head_media_as_proof():
    # Head carries the video, the reply carries the coordinate: one detection
    # with the head's permalink as provenance. The thread declares no source, so
    # the video is annotation (proof), not a deduced self-source.
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
    assert out[0].source_url is None
    assert out[0].source_media == []
    assert [m.remote_url for m in out[0].proof_media] == ["https://video.twimg.com/x.mp4"]


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


def test_malformed_time_recovers_date_and_nulls_detected_post_at():
    # A valid date with a garbled time-of-day: event_date is recovered from the
    # date prefix; detected_post_at is NULL, not a false 1970, and the source
    # slots stay empty (no source declared, no fabricated date).
    out = detect([_rec("1", "Strike 48.012345, 37.802411", created_at="2025-11-12T99:99:99Z")])
    assert len(out) == 1
    d = out[0]
    assert d.event_date == date(2025, 11, 12)
    assert d.source_posted_at is None
    assert d.detected_post_at is None


def test_fully_unparseable_timestamp_yields_no_dates():
    # Nothing recoverable: every date stays NULL rather than a fabricated epoch.
    out = detect([_rec("1", "Strike 48.012345, 37.802411", created_at="not-a-timestamp")])
    assert len(out) == 1
    d = out[0]
    assert d.event_date is None
    assert d.source_posted_at is None
    assert d.detected_post_at is None


# ── The strict structured mapper (the bot path) ───────────────────────────


def _struct_rec(
    text: str,
    *,
    quoted: QuotedTweet | None = None,
    external_sources: list[SourceLink] | None = None,
    media: list[ParsedMedia] | None = None,
) -> TweetRecord:
    return TweetRecord(
        tweet_id="10",
        handle="analyst",
        text=text,
        created_at="2026-03-11T12:00:00Z",
        permalink="https://x.com/analyst/status/10",
        media=media or [],
        quoted=quoted,
        external_sources=external_sources or [],
    )


_QUOTE = QuotedTweet(
    tweet_id="42",
    handle="warfootage",
    text="original footage",
    created_at="2026-03-10T09:00:00Z",
    media=[
        ParsedMedia(
            kind="video", remote_url="https://video.twimg.com/q.mp4", content_type="video/mp4"
        )
    ],
)

_CONFORMING = "@viditbot\nT: Strike on the depot\nC: 48.123456, 37.654321\nS: https://t.co/q\nSmoke plume matches"


def test_structured_conforming_tweet_maps_markers_to_fields():
    out = detect_structured(_struct_rec(_CONFORMING, quoted=_QUOTE), bot_handle="viditbot")
    assert len(out) == 1
    d = out[0]
    assert d.title == "Strike on the depot"
    assert d.coordinate.lat == pytest.approx(48.123456)
    assert d.coordinate.lng == pytest.approx(37.654321)
    assert d.source_url == "https://x.com/warfootage/status/42"
    assert d.source_posted_at is not None and d.source_posted_at.date() == date(2026, 3, 10)
    assert d.detected_from_url == "https://x.com/analyst/status/10"
    assert d.event_date == date(2026, 3, 11)


def test_structured_proof_is_the_non_marker_lines_only():
    record = _struct_rec(
        "Context first\n" + _CONFORMING + "\nSecond proof line https://t.co/x",
        quoted=_QUOTE,
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.proof_text == "Context first\nSmoke plume matches\nSecond proof line"
    # Markers, raw coordinate, the tag, and shortlinks are all gone.
    assert "T:" not in d.proof_text
    assert "48.123456" not in d.proof_text
    assert "viditbot" not in d.proof_text
    assert "t.co" not in d.proof_text


def test_structured_markers_are_case_insensitive():
    text = "@ViditBot\nt: Strike on the depot\nc: 48.123456, 37.654321\ns: https://t.co/q"
    out = detect_structured(_struct_rec(text, quoted=_QUOTE), bot_handle="viditbot")
    assert len(out) == 1
    assert out[0].title == "Strike on the depot"


@pytest.mark.parametrize(
    "text",
    [
        # Missing T
        "@viditbot\nC: 48.123456, 37.654321\nS: https://t.co/q",
        # Empty T
        "@viditbot\nT:\nC: 48.123456, 37.654321\nS: https://t.co/q",
        # Missing C
        "@viditbot\nT: Strike\nS: https://t.co/q",
        # Missing S
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321",
        # S without a URL
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: see the quote",
        # C is not a bare decimal pair
        "@viditbot\nT: Strike\nC: near the bridge\nS: https://t.co/q",
        # C carries trailing prose
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321 approx\nS: https://t.co/q",
        # C is DMS, not decimal
        "@viditbot\nT: Strike\nC: 48°00'45\"N 37°48'08\"E\nS: https://t.co/q",
        # C out of bounds
        "@viditbot\nT: Strike\nC: 95.000000, 37.654321\nS: https://t.co/q",
        # Free text everywhere, no markers at all
        "@viditbot Geolocated 48.123456, 37.654321 https://t.co/q",
    ],
)
def test_structured_rejects_any_incomplete_or_invalid_format(text):
    assert detect_structured(_struct_rec(text, quoted=_QUOTE), bot_handle="viditbot") == []


def test_structured_requires_a_resolvable_source():
    # S: line present, but the only link is an article (host ``other``):
    # outside the source vocabulary, so the mention does not conform.
    record = _struct_rec(
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/a",
        external_sources=[SourceLink(url="https://example.org/report", host="other")],
    )
    assert detect_structured(record, bot_handle="viditbot") == []


def test_structured_attached_media_is_proof_quote_media_is_source():
    own = ParsedMedia(
        kind="image", remote_url="https://pbs.twimg.com/own.jpg", content_type="image/jpeg"
    )
    (d,) = detect_structured(
        _struct_rec(_CONFORMING, quoted=_QUOTE, media=[own]), bot_handle="viditbot"
    )
    assert [m.remote_url for m in d.proof_media] == ["https://pbs.twimg.com/own.jpg"]
    assert [m.remote_url for m in d.source_media] == ["https://video.twimg.com/q.mp4"]


def test_structured_repeated_marker_keeps_first_value_and_strips_both():
    text = _CONFORMING + "\nT: A second title line"
    (d,) = detect_structured(_struct_rec(text, quoted=_QUOTE), bot_handle="viditbot")
    assert d.title == "Strike on the depot"
    assert "second title" not in d.proof_text


def test_structured_chases_the_sole_x_status_source():
    # No inline quote: the sole S: candidate is an X status, chased through
    # syndication for its media and post date.
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params["id"] == "77"
        return httpx.Response(
            200,
            json={
                "id_str": "77",
                "created_at": "2026-03-09T08:00:00.000Z",
                "user": {"screen_name": "warfootage"},
                "text": "original footage",
            },
        )

    record = _struct_rec(
        _CONFORMING,
        external_sources=[SourceLink(url="https://x.com/warfootage/status/77", host="x")],
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        (d,) = detect_structured(record, bot_handle="viditbot", client=client)
    assert d.source_url == "https://x.com/warfootage/status/77"
    assert d.source_posted_at is not None and d.source_posted_at.date() == date(2026, 3, 9)


def test_structured_telegram_source_is_link_and_embed_date():
    # A t.me source resolves through the existing embed chase: post date, and
    # media only when the embed serves it (none here, a valid outcome).
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=(
                '<div class="tgme_widget_message">'
                '<time datetime="2026-03-08T10:00:00+00:00"></time></div>'
            ),
        )

    record = _struct_rec(
        _CONFORMING,
        external_sources=[SourceLink(url="https://t.me/channel/5", host="telegram")],
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        (d,) = detect_structured(record, bot_handle="viditbot", client=client)
    assert d.source_url == "https://t.me/channel/5"
    assert d.source_posted_at is not None and d.source_posted_at.date() == date(2026, 3, 8)
    assert d.source_media == []


def test_structured_failed_chase_degrades_to_link_only():
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    record = _struct_rec(
        _CONFORMING,
        external_sources=[SourceLink(url="https://x.com/warfootage/status/78", host="x")],
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        (d,) = detect_structured(record, bot_handle="viditbot", client=client)
    assert d.source_url == "https://x.com/warfootage/status/78"
    assert d.source_posted_at is None
    assert d.source_media == []


# ── Archive regression: the free-text spine is untouched by the bot format ─


def test_archive_free_text_thread_detection_unchanged():
    # The archive backfill spine (stitch → detect) keeps the free-text
    # vocabulary and the same-author thread rollup: a coordinate in the head
    # and commentary in the reply still land as one detection with combined
    # proof, exactly as before the bot's strict format existed.
    head = _rec("1", "Geolocated 48.012345, 37.802411 near the bridge")
    reply = _rec("2", "More context on the strike", created_at="2025-11-12T14:40:00Z")
    reply = dataclasses.replace(reply, in_reply_to_status_id="1")
    threads = stitch([head, reply])
    out = [d for thread in threads for d in detect(thread)]
    assert len(out) == 1
    d = out[0]
    assert d.coordinate.lat == pytest.approx(48.012345)
    assert d.detected_from_url == "https://x.com/analyst/status/1"
    assert "near the bridge" in d.proof_text
    assert "More context on the strike" in d.proof_text
