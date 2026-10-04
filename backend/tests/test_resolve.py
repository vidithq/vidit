"""The engine: a thread becomes 0..N detections (pure, no DB).

Typology shapes live in ``tests/ingest_contract``; this file holds the edges it does not carry.
"""

from datetime import date

import pytest

from app.services.tweet_ingest import (
    COORDS_INVALID,
    COORDS_MISSING,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_MISSING,
    Detection,
)
from app.services.tweet_ingest.records import QuotedTweet, SourceLink, TweetRecord
from app.services.tweet_ingest.resolve import (
    Resolution,
    resolve_source,
    resolve_threads,
    split_media,
)
from app.services.tweet_ingest.syndication import ParsedMedia
from tests._fixtures import tweet_record as _rec

_INSTAGRAM = SourceLink(
    url="https://www.instagram.com/reel/FAKEREEL01/",
    shortlink="https://t.co/fakeIG",
)


def _media(kind: str, origin: str) -> ParsedMedia:
    url = (
        "https://pbs.twimg.com/media/x.jpg" if kind == "image" else "https://video.twimg.com/v.mp4"
    )
    return ParsedMedia(kind=kind, remote_url=url, origin=origin)  # type: ignore[arg-type]


def _resolve(thread: list[TweetRecord]) -> Resolution:
    return resolve_threads([thread])


def _detections(thread: list[TweetRecord]) -> list[Detection]:
    return _resolve(thread).detections


def _detection(thread: list[TweetRecord]) -> Detection:
    """The single detection a one-coordinate thread resolves to."""
    [detection] = _detections(thread)
    return detection


def _coords(thread: list[TweetRecord]):
    return [detection.coordinate for detection in _detections(thread)]


def test_coords_come_from_the_analysts_own_text():
    # Both posts carry one: the quoted author's is theirs, never the analyst's.
    quoted = QuotedTweet(tweet_id="2", handle="src", text="50.000000, 30.000000", created_at="")
    coords = _coords([_rec(text="strike 48.012345, 37.802411", quoted=quoted)])
    assert round(coords[0].lat, 3) == 48.012


def test_every_coordinate_makes_a_candidate():
    # No cap: the 6-decimal dedup is the only guard.
    text = "\n".join(f"4{i}.111111, 3{i}.222222" for i in range(5))
    assert len(_coords([_rec(text=text)])) == 5


def test_an_out_of_bounds_pair_is_named_as_such():
    # The one coordinate refusal an entry can tell apart from "none at all".
    resolution = _resolve([_rec(text="somewhere at 991.123456, 37.802411")])
    assert resolution.detections == []
    assert resolution.refusals == {COORDS_INVALID: 1}
    assert resolution.reason == COORDS_INVALID


def test_the_own_status_exclusion_is_case_insensitive():
    # X status URLs keep the handle's case.
    record = _rec(
        handle="analyst",
        external_sources=[SourceLink(url="https://x.com/Analyst/status/111")],
    )
    assert resolve_source([record]) == (None, None)


def test_a_google_maps_link_is_excluded():
    for url in (
        "https://maps.app.goo.gl/x",
        # Legacy share form.
        "https://goo.gl/maps/aBcDeF12345",
        "https://www.google.com/maps/@48.012345,37.802411,15z",
        "https://maps.google.com/?q=48.012345,37.802411",
    ):
        assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (None, None)


def test_a_goo_gl_link_outside_maps_stays_a_candidate():
    # The shortener serves every Google product; only the ``/maps/`` prefix marks a coordinate.
    url = "https://goo.gl/photos/aBcDeF12345"
    assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (url, None)


def test_two_records_quoting_one_post_are_one_candidate():
    # Quoting the same footage twice names one post.
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    url, posted = resolve_source(
        [_rec(tweet_id="1", quoted=quoted), _rec(tweet_id="2", quoted=quoted)]
    )
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_proof_keeps_a_reference_link_readable():
    # Raw text carries opaque t.co wrappers; the entity's expansion keeps the proof readable.
    record = _rec(
        text="Strike at 48.012345, 37.802411\nSource: https://t.co/fakeIG",
        external_sources=[_INSTAGRAM],
    )
    assert _detection([record]).proof_text.splitlines()[-1] == f"Source: {_INSTAGRAM.url}"


def test_split_media_promotes_only_the_first_own_video_to_source():
    # Proof embeds images only, so a video left there would be dropped at persistence.
    # The second video stays annotation: one role=source media per event.
    record = _rec(media=[_media("image", "op"), _media("video", "op"), _media("video", "op")])
    source, proof = split_media([record])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image", "video"]


def test_split_media_quote_keeps_precedence_over_an_own_video():
    # A quote is the source even without media, so the own video stays annotation.
    quoted = QuotedTweet(tweet_id="2", handle="src", text="", created_at="")
    source, proof = split_media([_rec(media=[_media("video", "op")], quoted=quoted)])
    assert source == []
    assert [m.kind for m in proof] == ["video"]


def test_a_single_coordinate_resolves_to_one_detection():
    detection = _detection([_rec(text="Strike at 48.012345, 37.802411 in Donetsk")])
    assert detection.coordinate.lat == pytest.approx(48.012345)
    assert detection.coordinate.lng == pytest.approx(37.802411)
    assert detection.detected_from_tweet_id == 1
    assert detection.detected_from_url == "https://x.com/analyst/status/1"
    assert detection.event_date == date(2025, 11, 12)
    # No source is deduced from the tweet's own URL or date.
    assert detection.source_url is None
    assert detection.source_posted_at is None


def test_the_provenance_url_is_built_from_the_id_whatever_case_the_handle_carried():
    # The id is the identity, so a handle spelled two ways cannot split one post.
    lower = _detection([_rec(text="48.012345, 37.802411", handle="analyst")])
    upper = _detection([_rec(text="48.012345, 37.802411", handle="Analyst")])
    assert lower.detected_from_tweet_id == upper.detected_from_tweet_id == 1
    assert upper.detected_from_url == "https://x.com/Analyst/status/1"


def test_malformed_time_recovers_date_and_nulls_detected_post_at():
    # event_date is recovered from the date prefix; detected_post_at is NULL, not a false 1970.
    detection = _detection(
        [_rec(text="Strike 48.012345, 37.802411", created_at="2025-11-12T99:99:99Z")]
    )
    assert detection.event_date == date(2025, 11, 12)
    assert detection.source_posted_at is None
    assert detection.detected_post_at is None


def test_fully_unparseable_timestamp_yields_no_dates():
    detection = _detection([_rec(text="Strike 48.012345, 37.802411", created_at="not-a-timestamp")])
    assert detection.event_date is None
    assert detection.source_posted_at is None
    assert detection.detected_post_at is None


def test_several_candidate_links_warn_source_ambiguous():
    detection = _detection(
        [
            _rec(
                text="Geolocated 48.012345, 37.802411",
                external_sources=[
                    SourceLink(url="https://t.me/chan/1"),
                    SourceLink(url="https://youtu.be/xyz"),
                ],
            )
        ]
    )
    assert detection.warnings == [SOURCE_AMBIGUOUS]
    assert detection.source_url is None
    assert detection.secondary_source_urls == ["https://t.me/chan/1", "https://youtu.be/xyz"]


def test_the_resolution_counts_what_its_detections_carry():
    # One count per detection carrying the warning, not per thread.
    resolution = _resolve([_rec(text="Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert resolution.warnings == {SEVERAL_COORDINATES: 2, SOURCE_MISSING: 2}


def test_an_empty_thread_is_refused_as_missing():
    assert _resolve([]).reason == COORDS_MISSING


def test_several_threads_resolve_into_one_batch():
    resolution = resolve_threads(
        [
            [_rec(tweet_id="1", text="Geolocated 48.012345, 37.802411")],
            [_rec(tweet_id="2", text="Nothing to pin down here")],
            [_rec(tweet_id="3", text="Out at 991.123456, 37.802411")],
            [_rec(tweet_id="4", text="Also nothing")],
        ]
    )
    assert [d.detected_from_tweet_id for d in resolution.detections] == [1]
    assert resolution.refusals == {COORDS_MISSING: 2, COORDS_INVALID: 1}
    # Several refusal reasons, so none is named.
    assert resolution.reason is None
