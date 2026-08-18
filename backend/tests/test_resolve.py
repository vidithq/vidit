"""The engine: a thread becomes 0..N drafts, plus what they still need.

Pure, no DB. The shapes themselves are pinned typology by typology, on all four
consumers, by ``tests/ingest_contract``; what is left here is the edges that
catalogue does not carry: an unbounded coordinate count, an out-of-bounds pair,
the spellings of a Google Maps link, a garbled timestamp, and the batch a
multi-thread export resolves into.
"""

from datetime import date

import pytest

from app.services.tweet_ingest import (
    COORDS_INVALID,
    COORDS_MISSING,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_MISSING,
    Draft,
)
from app.services.tweet_ingest.records import QuotedTweet, SourceLink, TweetRecord
from app.services.tweet_ingest.resolve import (
    Resolution,
    resolve_source,
    resolve_threads,
    split_media,
)
from app.services.tweet_ingest.syndication import ParsedMedia

_INSTAGRAM = SourceLink(
    url="https://www.instagram.com/reel/FAKEREEL01/",
    shortlink="https://t.co/fakeIG",
)


def _media(kind: str, origin: str) -> ParsedMedia:
    url = (
        "https://pbs.twimg.com/media/x.jpg" if kind == "image" else "https://video.twimg.com/v.mp4"
    )
    return ParsedMedia(kind=kind, remote_url=url, origin=origin)  # type: ignore[arg-type]


def _rec(**kw: object) -> TweetRecord:
    base: dict = dict(
        tweet_id="1",
        handle="analyst",
        text="",
        created_at="2025-11-12T14:33:00Z",
    )
    base.update(kw)
    return TweetRecord(**base)


def _resolve(thread: list[TweetRecord]) -> Resolution:
    return resolve_threads([thread])


def _drafts(thread: list[TweetRecord]) -> list[Draft]:
    return _resolve(thread).drafts


def _draft(thread: list[TweetRecord]) -> Draft:
    """The single draft a one-coordinate thread resolves to."""
    [draft] = _drafts(thread)
    return draft


def _coords(thread: list[TweetRecord]):
    return [draft.coordinate for draft in _drafts(thread)]


# ── Coordinates ───────────────────────────────────────────────────────────


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
    assert resolution.drafts == []
    assert resolution.refusals == {COORDS_INVALID: 1}
    assert resolution.reason == COORDS_INVALID


# ── Source ────────────────────────────────────────────────────────────────


def test_the_own_status_exclusion_is_case_insensitive():
    # X status URLs don't lowercase the handle segment.
    record = _rec(
        handle="analyst",
        external_sources=[SourceLink(url="https://x.com/Analyst/status/111")],
    )
    assert resolve_source([record]) == (None, None)


def test_a_google_maps_link_is_excluded():
    for url in (
        "https://maps.app.goo.gl/x",
        # The legacy share form, still all over older posts.
        "https://goo.gl/maps/aBcDeF12345",
        "https://www.google.com/maps/@48.012345,37.802411,15z",
        "https://maps.google.com/?q=48.012345,37.802411",
    ):
        assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (None, None)


def test_a_goo_gl_link_outside_maps_stays_a_candidate():
    # The bare shortener serves every Google product, so only the ``/maps/``
    # prefix says "this points at a coordinate rather than at footage".
    url = "https://goo.gl/photos/aBcDeF12345"
    assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (url, None)


def test_two_records_quoting_one_post_are_one_candidate():
    # A thread that repeats its quote (the analyst quote-tweets the same footage
    # twice) names one post, so the slot fills as a single quote would.
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    url, posted = resolve_source(
        [_rec(tweet_id="1", quoted=quoted), _rec(tweet_id="2", quoted=quoted)]
    )
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


# ── Proof ─────────────────────────────────────────────────────────────────


def test_proof_keeps_a_reference_link_readable():
    # Raw tweet text carries only opaque t.co wrappers; the entity's expansion is
    # what keeps the link readable in the stored proof.
    record = _rec(
        text="Strike at 48.012345, 37.802411\nSource: https://t.co/fakeIG",
        external_sources=[_INSTAGRAM],
    )
    assert _draft([record]).proof_text.splitlines()[-1] == f"Source: {_INSTAGRAM.url}"


# ── Media split ───────────────────────────────────────────────────────────


def test_split_media_promotes_only_the_first_own_video_to_source():
    # Nothing else can fill the source slot and the proof document embeds images
    # only, so leaving the video in proof would drop it at persistence. The
    # second one stays annotation: one role=source media per event.
    record = _rec(media=[_media("image", "op"), _media("video", "op"), _media("video", "op")])
    source, proof = split_media([record])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image", "video"]


def test_split_media_quote_keeps_precedence_over_an_own_video():
    # A quote is the source even when it carried no media at all, so the
    # analyst's own video stays annotation.
    quoted = QuotedTweet(tweet_id="2", handle="src", text="", created_at="")
    source, proof = split_media([_rec(media=[_media("video", "op")], quoted=quoted)])
    assert source == []
    assert [m.kind for m in proof] == ["video"]


# ── The draft a thread resolves to ────────────────────────────────────────


def test_a_single_coordinate_resolves_to_one_draft():
    draft = _draft([_rec(text="Strike at 48.012345, 37.802411 in Donetsk")])
    assert draft.coordinate.lat == pytest.approx(48.012345)
    assert draft.coordinate.lng == pytest.approx(37.802411)
    assert draft.detected_from_tweet_id == 1
    assert draft.detected_from_url == "https://x.com/analyst/status/1"
    assert draft.event_date == date(2025, 11, 12)
    # A referenceless annotation declares no source: both slots stay empty
    # rather than deducing the tweet's own URL / date.
    assert draft.source_url is None
    assert draft.source_posted_at is None


def test_the_provenance_url_is_built_from_the_id_whatever_case_the_handle_carried():
    # The id is the identity; the URL is written from it at the exit, so a
    # handle spelled two ways in one export cannot split one post in two.
    lower = _draft([_rec(text="48.012345, 37.802411", handle="analyst")])
    upper = _draft([_rec(text="48.012345, 37.802411", handle="Analyst")])
    assert lower.detected_from_tweet_id == upper.detected_from_tweet_id == 1
    assert upper.detected_from_url == "https://x.com/Analyst/status/1"


def test_malformed_time_recovers_date_and_nulls_detected_post_at():
    # A valid date with a garbled time-of-day: event_date is recovered from the
    # date prefix; detected_post_at is NULL, not a false 1970, and the source
    # slots stay empty (no source declared, no fabricated date).
    draft = _draft([_rec(text="Strike 48.012345, 37.802411", created_at="2025-11-12T99:99:99Z")])
    assert draft.event_date == date(2025, 11, 12)
    assert draft.source_posted_at is None
    assert draft.detected_post_at is None


def test_fully_unparseable_timestamp_yields_no_dates():
    # Nothing recoverable: every date stays NULL rather than a fabricated epoch.
    draft = _draft([_rec(text="Strike 48.012345, 37.802411", created_at="not-a-timestamp")])
    assert draft.event_date is None
    assert draft.source_posted_at is None
    assert draft.detected_post_at is None


# ── Warnings and refusals: what every entry surfaces ──────────────────────


def test_several_candidate_links_warn_source_ambiguous():
    draft = _draft(
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
    assert draft.warnings == [SOURCE_AMBIGUOUS]
    assert draft.source_url is None
    assert draft.secondary_source_urls == ["https://t.me/chan/1", "https://youtu.be/xyz"]


def test_the_resolution_counts_what_its_drafts_carry():
    # The count the bot's reply and the archive's outcome email both read: one
    # per draft carrying the warning, not one per thread that raised it.
    resolution = _resolve([_rec(text="Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert resolution.warnings == {SEVERAL_COORDINATES: 2, SOURCE_MISSING: 2}


def test_an_empty_thread_is_refused_as_missing():
    assert _resolve([]).reason == COORDS_MISSING


def test_several_threads_resolve_into_one_batch():
    # The export shape: the drafts of every thread in one list, thread by
    # thread, and one count per refusal code across the threads that gave none.
    resolution = resolve_threads(
        [
            [_rec(tweet_id="1", text="Geolocated 48.012345, 37.802411")],
            [_rec(tweet_id="2", text="Nothing to pin down here")],
            [_rec(tweet_id="3", text="Out at 991.123456, 37.802411")],
            [_rec(tweet_id="4", text="Also nothing")],
        ]
    )
    assert [d.detected_from_tweet_id for d in resolution.drafts] == [1]
    assert resolution.refusals == {COORDS_MISSING: 2, COORDS_INVALID: 1}
    # Several reasons, so no single one to name back even though nothing landed
    # for three of the four threads.
    assert resolution.reason is None
