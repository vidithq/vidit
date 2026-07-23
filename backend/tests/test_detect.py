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
    detect_relay,
    detect_structured,
    detect_structured_diagnosed,
    fetch_relay_parent,
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

# The quote's link entity: the raw text carries the ``t.co`` token, the entity
# expands it, and the S: line designates the source by binding to it.
_QUOTE_LINK = SourceLink(
    url="https://x.com/warfootage/status/42", host="x", shortlink="https://t.co/q"
)

_CONFORMING = (
    "@viditbot\nT: Strike on the depot\nC: 48.123456, 37.654321\nS: https://t.co/q"
    "\nSmoke plume matches"
)


def _quoted_rec(text: str = _CONFORMING, media: list[ParsedMedia] | None = None) -> TweetRecord:
    return _struct_rec(text, quoted=_QUOTE, external_sources=[_QUOTE_LINK], media=media)


def test_structured_conforming_tweet_maps_markers_to_fields():
    out = detect_structured(_quoted_rec(), bot_handle="viditbot")
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
    record = _quoted_rec("Context first\n" + _CONFORMING + "\nSecond proof line https://t.co/x")
    (d,) = detect_structured(record, bot_handle="viditbot")
    # https://t.co/x has no entity (the wrapper X appends for media): stripped.
    assert d.proof_text == "Context first\nSmoke plume matches\nSecond proof line"
    # Markers, raw coordinate, the tag, and leftover shortlinks are all gone.
    assert "T:" not in d.proof_text
    assert "48.123456" not in d.proof_text
    assert "viditbot" not in d.proof_text
    assert "t.co" not in d.proof_text


def test_structured_proof_reference_link_survives_expanded():
    # A link on a proof line neither influences the source nor fails the
    # mention; its opaque t.co token is expanded to the real URL in the proof.
    ref = SourceLink(url="https://example.org/report", host="other", shortlink="https://t.co/ref")
    record = _struct_rec(
        _CONFORMING + "\nBackground reading https://t.co/ref",
        quoted=_QUOTE,
        external_sources=[_QUOTE_LINK, ref],
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.source_url == "https://x.com/warfootage/status/42"
    assert "Background reading https://example.org/report" in d.proof_text
    assert "t.co" not in d.proof_text


def test_structured_markers_are_case_insensitive():
    text = "@ViditBot\nt: Strike on the depot\nc: 48.123456, 37.654321\ns: https://t.co/q"
    out = detect_structured(_quoted_rec(text), bot_handle="viditbot")
    assert len(out) == 1
    assert out[0].title == "Strike on the depot"


@pytest.mark.parametrize(
    "text",
    [
        # Missing T
        "@viditbot\nC: 48.123456, 37.654321\nS: https://t.co/q",
        # Empty T with no later value
        "@viditbot\nT:\nC: 48.123456, 37.654321\nS: https://t.co/q",
        # Missing C
        "@viditbot\nT: Strike\nS: https://t.co/q",
        # Missing S
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321",
        # S without a URL token and without a quote
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: see my pinned post",
        # Two URL tokens on the S line
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/q https://t.co/r",
        # S token binding to no link entity
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/nope",
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
    # No inline quote: the record carries the quote's link entity only, so
    # every rejection here is the format's, not a missing-fixture artefact.
    record = _struct_rec(text, external_sources=[_QUOTE_LINK])
    assert detect_structured(record, bot_handle="viditbot") == []


@pytest.mark.parametrize(
    "text",
    [
        # An empty marker line never shadows the real value further down.
        "@viditbot\nT:\nT: Strike on the depot\nC: 48.123456, 37.654321\nS: https://t.co/q",
        "@viditbot\nT: Strike on the depot\nC:\nC: 48.123456, 37.654321\nS: https://t.co/q",
        "@viditbot\nT: Strike on the depot\nC: 48.123456, 37.654321\nS:\nS: https://t.co/q",
    ],
)
def test_structured_empty_marker_line_does_not_shadow_a_later_value(text):
    out = detect_structured(_quoted_rec(text), bot_handle="viditbot")
    assert len(out) == 1
    d = out[0]
    assert d.title == "Strike on the depot"
    assert d.coordinate.lat == pytest.approx(48.123456)
    # Both marker lines (the empty and the real one) are stripped from proof.
    assert "Strike on the depot" not in d.proof_text
    assert "T:" not in d.proof_text and "C:" not in d.proof_text and "S:" not in d.proof_text


def test_structured_off_vocabulary_link_is_stored_link_only():
    # S: designates a link outside the chase vocabulary (host ``other``): the
    # link is stored as the source, with no media fetch and no post date.
    record = _struct_rec(
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/a",
        external_sources=[
            SourceLink(url="https://example.org/report", host="other", shortlink="https://t.co/a")
        ],
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.source_url == "https://example.org/report"
    assert d.source_posted_at is None
    assert d.source_media == []


def test_structured_own_status_link_is_not_a_source():
    # S: linking the author's own post stays a format failure: a
    # cross-reference, never footage.
    record = _struct_rec(
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/me",
        external_sources=[
            SourceLink(url="https://x.com/analyst/status/9", host="x", shortlink="https://t.co/me")
        ],
    )
    assert detect_structured(record, bot_handle="viditbot") == []


def test_structured_attached_media_is_proof_quote_media_is_source():
    own = ParsedMedia(
        kind="image", remote_url="https://pbs.twimg.com/own.jpg", content_type="image/jpeg"
    )
    (d,) = detect_structured(_quoted_rec(media=[own]), bot_handle="viditbot")
    assert [m.remote_url for m in d.proof_media] == ["https://pbs.twimg.com/own.jpg"]
    assert [m.remote_url for m in d.source_media] == ["https://video.twimg.com/q.mp4"]


def test_structured_repeated_marker_keeps_first_value_and_strips_both():
    text = _CONFORMING + "\nT: A second title line"
    (d,) = detect_structured(_quoted_rec(text), bot_handle="viditbot")
    assert d.title == "Strike on the depot"
    assert "second title" not in d.proof_text


def test_structured_s_line_designates_among_several_links():
    # Two footage links in the tweet: the S: token picks the Telegram one;
    # the X status on a proof line neither competes nor fails the mention
    # (under the old whole-record resolution two candidates were ambiguous).
    telegram = SourceLink(url="https://t.me/channel/5", host="telegram", shortlink="https://t.co/s")
    other = SourceLink(
        url="https://x.com/warfootage/status/77", host="x", shortlink="https://t.co/p"
    )
    record = _struct_rec(
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/s\nsee also https://t.co/p",
        external_sources=[telegram, other],
    )

    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(404)  # embed unavailable: degrades to link-only

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        (d,) = detect_structured(record, bot_handle="viditbot", client=client)
    assert d.source_url == "https://t.me/channel/5"
    assert "see also https://x.com/warfootage/status/77" in d.proof_text


def test_structured_non_designated_quote_does_not_steal_the_source():
    # The tweet quotes one post but S: designates a Telegram link: the S:
    # choice wins, and the quote's media must not land in the source slot.
    telegram = SourceLink(url="https://t.me/channel/5", host="telegram", shortlink="https://t.co/s")
    record = _struct_rec(
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/s",
        quoted=_QUOTE,
        external_sources=[telegram],
    )

    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        (d,) = detect_structured(record, bot_handle="viditbot", client=client)
    assert d.source_url == "https://t.me/channel/5"
    assert d.source_media == []


def test_structured_quote_card_without_token_designates_the_quote():
    # X converted the pasted S: URL into the quote card and stripped the
    # trailing t.co from the text: the quote IS the link that was on S:.
    record = _struct_rec(
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: source below",
        quoted=_QUOTE,
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.source_url == "https://x.com/warfootage/status/42"
    assert d.source_posted_at is not None and d.source_posted_at.date() == date(2026, 3, 10)
    assert [m.remote_url for m in d.source_media] == ["https://video.twimg.com/q.mp4"]


def test_structured_chases_the_designated_x_status():
    # No inline quote: the designated S: entity is an X status, chased
    # through syndication for its media and post date.
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
        external_sources=[
            SourceLink(
                url="https://x.com/warfootage/status/77", host="x", shortlink="https://t.co/q"
            )
        ],
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
        external_sources=[
            SourceLink(url="https://t.me/channel/5", host="telegram", shortlink="https://t.co/q")
        ],
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
        external_sources=[
            SourceLink(
                url="https://x.com/warfootage/status/78", host="x", shortlink="https://t.co/q"
            )
        ],
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        (d,) = detect_structured(record, bot_handle="viditbot", client=client)
    assert d.source_url == "https://x.com/warfootage/status/78"
    assert d.source_posted_at is None
    assert d.source_media == []


def test_structured_chase_transport_error_degrades_to_link_only():
    # A flaky network during the chase (raw httpx.ConnectError from the
    # transport) must degrade to link-only, never ledger the mention failed.
    def handler(_req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    record = _struct_rec(
        _CONFORMING,
        external_sources=[
            SourceLink(
                url="https://x.com/warfootage/status/79", host="x", shortlink="https://t.co/q"
            )
        ],
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        (d,) = detect_structured(record, bot_handle="viditbot", client=client)
    assert d.source_url == "https://x.com/warfootage/status/79"
    assert d.source_posted_at is None
    assert d.source_media == []


# ── The bare form (unprefixed): the shape carries the fields ──────────────


_REPORT_LINK = SourceLink(
    url="https://example.org/report", host="other", shortlink="https://t.co/r"
)

_BARE_CONFORMING = (
    "@viditbot\nStrike on the depot\n48.123456, 37.654321\nhttps://t.co/r\nSmoke plume matches"
)


def test_bare_conforming_tweet_maps_shape_to_fields():
    record = _struct_rec(_BARE_CONFORMING, external_sources=[_REPORT_LINK])
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.title == "Strike on the depot"
    assert d.coordinate.lat == pytest.approx(48.123456)
    assert d.coordinate.lng == pytest.approx(37.654321)
    assert d.source_url == "https://example.org/report"
    assert d.proof_text == "Smoke plume matches"
    assert "48.123456" not in d.proof_text and "t.co" not in d.proof_text


def test_bare_quote_card_is_the_designated_source():
    record = _struct_rec(
        "@viditbot\nStrike on the depot\n48.123456, 37.654321\nSmoke plume matches",
        quoted=_QUOTE,
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.title == "Strike on the depot"
    assert d.source_url == "https://x.com/warfootage/status/42"
    assert d.source_posted_at is not None and d.source_posted_at.date() == date(2026, 3, 10)
    assert [m.remote_url for m in d.source_media] == ["https://video.twimg.com/q.mp4"]


def test_bare_sole_inline_link_is_the_source():
    # No URL-only line, no quote, but exactly one link entity in the post:
    # that link is the source, and its prose line stays proof, expanded.
    record = _struct_rec(
        "@viditbot\nStrike on the depot\n48.123456, 37.654321\nGeolocated from https://t.co/r footage",
        external_sources=[_REPORT_LINK],
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.source_url == "https://example.org/report"
    assert "Geolocated from https://example.org/report footage" in d.proof_text


def test_bare_several_inline_links_are_ambiguous():
    # Two entities and none alone on its line: no deterministic designation.
    other = SourceLink(url="https://example.org/other", host="other", shortlink="https://t.co/o")
    record = _struct_rec(
        "@viditbot\nStrike on the depot\n48.123456, 37.654321\nsee https://t.co/r and https://t.co/o",
        external_sources=[_REPORT_LINK, other],
    )
    assert detect_structured(record, bot_handle="viditbot") == []


def test_bare_url_only_line_designates_among_several_links():
    # Same two entities, but one sits alone on its line: that one is the
    # source; the other stays a proof reference.
    other = SourceLink(url="https://example.org/other", host="other", shortlink="https://t.co/o")
    record = _struct_rec(
        "@viditbot\nStrike on the depot\n48.123456, 37.654321\nhttps://t.co/r\nsee also https://t.co/o",
        external_sources=[_REPORT_LINK, other],
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.source_url == "https://example.org/report"
    assert "see also https://example.org/other" in d.proof_text


def test_bare_two_coordinate_lines_are_ambiguous():
    record = _struct_rec(
        "@viditbot\nStrike on the depot\n48.123456, 37.654321\n50.450100, 30.523400\nhttps://t.co/r",
        external_sources=[_REPORT_LINK],
    )
    assert detect_structured(record, bot_handle="viditbot") == []


def test_bare_unbound_media_wrapper_line_is_ignored():
    # X appends the attached-media t.co wrapper to the text; whole-line but
    # binding to no entity, it neither designates nor fails, and never
    # becomes the title.
    record = _struct_rec(
        "@viditbot\nStrike on the depot\n48.123456, 37.654321\nhttps://t.co/r\nhttps://t.co/media",
        external_sources=[_REPORT_LINK],
    )
    (d,) = detect_structured(record, bot_handle="viditbot")
    assert d.source_url == "https://example.org/report"
    assert d.title == "Strike on the depot"
    assert "t.co" not in d.proof_text


def test_partial_markers_never_fall_back_to_the_bare_shape():
    # One marker pins the marker form: an incomplete set is a mistake to
    # teach, not a bare-shape guess.
    record = _struct_rec(
        "@viditbot\nT: Strike on the depot\n48.123456, 37.654321\nhttps://t.co/r",
        external_sources=[_REPORT_LINK],
    )
    assert detect_structured_diagnosed(record, bot_handle="viditbot") == (
        [],
        "markers_incomplete",
    )


def test_empty_marker_line_pins_the_marker_form():
    # A lone empty ``T:`` must fail loudly, never leak the literal "T:" line
    # into the bare shape as the title.
    record = _struct_rec(
        "@viditbot\nT:\nStrike on the depot\n48.123456, 37.654321\nhttps://t.co/r",
        external_sources=[_REPORT_LINK],
    )
    assert detect_structured_diagnosed(record, bot_handle="viditbot") == (
        [],
        "markers_incomplete",
    )


@pytest.mark.parametrize(
    ("text", "reason"),
    [
        # Free text: no whole-line pair anywhere.
        ("@viditbot Geolocated 48.123456, 37.654321 near https://t.co/r", "coords_missing"),
        # Two whole-line pairs.
        (
            "@viditbot\nStrike\n48.123456, 37.654321\n50.450100, 30.523400\nhttps://t.co/r",
            "coords_ambiguous",
        ),
        # A pair alone on its line but out of bounds.
        ("@viditbot\nStrike\n95.123456, 37.654321\nhttps://t.co/r", "coords_invalid"),
        # No link, no quote.
        ("@viditbot\nStrike on the depot\n48.123456, 37.654321", "source_missing"),
    ],
)
def test_bare_failures_carry_their_reason(text, reason):
    sources = [_REPORT_LINK] if "t.co/r" in text else []
    record = _struct_rec(text, external_sources=sources)
    assert detect_structured_diagnosed(record, bot_handle="viditbot") == ([], reason)


def test_own_status_source_carries_the_own_reason():
    record = _struct_rec(
        "@viditbot\nT: Strike\nC: 48.123456, 37.654321\nS: https://t.co/me",
        external_sources=[
            SourceLink(url="https://x.com/analyst/status/9", host="x", shortlink="https://t.co/me")
        ],
    )
    assert detect_structured_diagnosed(record, bot_handle="viditbot") == ([], "source_own")


# ── The relay mapper (the bot's two-tweet form) ───────────────────────────


# An S: link outside the chase vocabulary (host ``other``): the relay form's
# reason to exist — the footage cannot be fetched from it.
_OFF_VOCAB = SourceLink(
    url="https://www.tiktok.com/@war/video/7", host="other", shortlink="https://t.co/tk"
)

_RELAY_VIDEO = ParsedMedia(
    kind="video", remote_url="https://video.twimg.com/relay.mp4", content_type="video/mp4"
)

_PARENT_TEXT = (
    "T: Strike on the depot\nC: 48.123456, 37.654321\nS: https://t.co/tk\nSmoke plume matches"
)


def _relay_parent_rec(
    text: str = _PARENT_TEXT,
    *,
    quoted: QuotedTweet | None = None,
    external_sources: list[SourceLink] | None = None,
    media: list[ParsedMedia] | None = None,
) -> TweetRecord:
    return TweetRecord(
        tweet_id="20",
        handle="analyst",
        text=text,
        created_at="2026-03-11T12:00:00Z",
        permalink="https://x.com/analyst/status/20",
        media=media or [],
        quoted=quoted,
        external_sources=external_sources if external_sources is not None else [_OFF_VOCAB],
    )


def _relay_reply_rec(
    text: str = "@viditbot footage saved below",
    *,
    handle: str = "analyst",
    media: list[ParsedMedia] | None = None,
) -> TweetRecord:
    return TweetRecord(
        tweet_id="21",
        handle=handle,
        text=text,
        created_at="2026-03-11T12:05:00Z",
        permalink=f"https://x.com/{handle}/status/21",
        media=[_RELAY_VIDEO] if media is None else media,
        in_reply_to_status_id="20",
    )


def test_relay_reply_media_is_the_source_media():
    proof_img = ParsedMedia(
        kind="image", remote_url="https://pbs.twimg.com/own.jpg", content_type="image/jpeg"
    )
    parent = _relay_parent_rec(media=[proof_img])
    (d,) = detect_relay(_relay_reply_rec(), parent, bot_handle="viditbot")
    # The parent runs the same strict mapper as an inline mention.
    assert d.title == "Strike on the depot"
    assert d.coordinate.lat == pytest.approx(48.123456)
    assert d.source_url == "https://www.tiktok.com/@war/video/7"
    assert d.source_posted_at is None  # off-vocabulary: nothing to chase
    # Idempotency anchors on the parent: tagging both tweets lands on one key.
    assert d.detected_from_url == "https://x.com/analyst/status/20"
    # The reply's attachment is the footage; the parent's stays annotation.
    assert [m.remote_url for m in d.source_media] == ["https://video.twimg.com/relay.mp4"]
    assert [m.remote_url for m in d.proof_media] == ["https://pbs.twimg.com/own.jpg"]
    # The reply's caption joins the proof, tag stripped.
    assert d.proof_text == "Smoke plume matches\nfootage saved below"
    assert "viditbot" not in d.proof_text


def test_relay_requires_the_same_author():
    # A stranger replying under the analyst's marker tweet cannot relay
    # media onto it.
    reply = _relay_reply_rec(handle="stranger")
    assert detect_relay(reply, _relay_parent_rec(), bot_handle="viditbot") == []


def test_relay_nonconforming_parent_yields_nothing():
    parent = _relay_parent_rec("Geolocated 48.123456, 37.654321 near the depot")
    assert detect_relay(_relay_reply_rec(), parent, bot_handle="viditbot") == []


def test_relay_without_media_resolves_the_parent_as_if_inline():
    # A media-less reply-tag still counts (the analyst forgot the inline tag):
    # the parent resolves exactly as an inline mention would, plus the caption.
    (d,) = detect_relay(_relay_reply_rec(media=[]), _relay_parent_rec(), bot_handle="viditbot")
    assert d.source_url == "https://www.tiktok.com/@war/video/7"
    assert d.source_media == []
    assert d.proof_text == "Smoke plume matches\nfootage saved below"


def test_relay_media_outranks_chased_media_but_keeps_the_chased_date():
    # The parent's S: resolved to the quote card (media + date known). The
    # reply's re-upload still wins the source slot — the analyst's explicit
    # gesture — while the chased post date is kept.
    parent = _relay_parent_rec(
        "T: Strike on the depot\nC: 48.123456, 37.654321\nS: source below",
        quoted=_QUOTE,
        external_sources=[],
    )
    (d,) = detect_relay(_relay_reply_rec(), parent, bot_handle="viditbot")
    assert d.source_url == "https://x.com/warfootage/status/42"
    assert d.source_posted_at is not None and d.source_posted_at.date() == date(2026, 3, 10)
    assert [m.remote_url for m in d.source_media] == ["https://video.twimg.com/relay.mp4"]


def test_relay_accepts_a_bare_parent():
    # The relay parent runs the same mapper, so the bare shape works there too.
    parent = _relay_parent_rec(
        "Strike on the depot\n48.123456, 37.654321\nhttps://t.co/tk\nSmoke plume matches"
    )
    (d,) = detect_relay(_relay_reply_rec(), parent, bot_handle="viditbot")
    assert d.title == "Strike on the depot"
    assert d.source_url == "https://www.tiktok.com/@war/video/7"
    assert [m.remote_url for m in d.source_media] == ["https://video.twimg.com/relay.mp4"]


def test_relay_reply_markers_never_shadow_the_parent():
    # Marker-shaped lines on the reply are dropped from the caption, never
    # merged into the parent's fields (a fully conforming reply would have
    # taken the inline path before relay is ever consulted).
    reply = _relay_reply_rec("@viditbot\nT: A different title\ncaption line")
    (d,) = detect_relay(reply, _relay_parent_rec(), bot_handle="viditbot")
    assert d.title == "Strike on the depot"
    assert "different title" not in d.proof_text
    assert "caption line" in d.proof_text


# ── fetch_relay_parent: the one-hop, fail-soft parent fetch ───────────────


# Distinct parent ids per test: the syndication fetch caches by tweet id
# process-wide, so re-using one id across tests would leak the first body.
def _reply_to(parent_id: str) -> TweetRecord:
    return dataclasses.replace(_relay_reply_rec(), in_reply_to_status_id=parent_id)


def _parent_body(parent_id: str, handle: str = "analyst") -> dict:
    return {
        "id_str": parent_id,
        "created_at": "2026-03-11T12:00:00.000Z",
        "user": {"screen_name": handle},
        "text": _PARENT_TEXT,
    }


def test_fetch_relay_parent_returns_the_self_reply_parent():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params["id"] == "9400000000000000201"
        return httpx.Response(200, json=_parent_body("9400000000000000201"))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        parent = fetch_relay_parent(_reply_to("9400000000000000201"), client=client)
    assert parent is not None
    assert parent.tweet_id == "9400000000000000201"
    assert parent.handle == "analyst"


def test_fetch_relay_parent_is_none_for_a_non_reply():
    def handler(_req: httpx.Request) -> httpx.Response:
        raise AssertionError("a non-reply must trigger no fetch")

    record = dataclasses.replace(_relay_reply_rec(), in_reply_to_status_id=None)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_relay_parent(record, client=client) is None


def test_fetch_relay_parent_rejects_another_authors_parent():
    # The authoritative same-author guard runs on the FETCHED handle: the URL
    # is built from the tagger's handle, but syndication returns the real one.
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_parent_body("9400000000000000202", "someone_else"))

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_relay_parent(_reply_to("9400000000000000202"), client=client) is None


def test_fetch_relay_parent_fetch_failure_degrades_to_none():
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(404)  # parent deleted / protected

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_relay_parent(_reply_to("9400000000000000203"), client=client) is None


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
