"""The engine: a thread becomes 0..N drafts, plus what they still need.

Pure, no DB. The first sections cover the derivations every entry runs (the
bot, the pasted import, the archive backfill), so the three agree on which
coordinate, which source URL and date, and which media is footage vs
annotation. The last sections cover the whole thread-to-draft boundary: the
warnings a draft carries and the reason a thread produced none, which is the
engine's answer and what every entry surfaces.
"""

import dataclasses
from datetime import date

import pytest

from app.services.tweet_ingest import (
    COORDS_INVALID,
    COORDS_MISSING,
    SEVERAL_COORDINATES,
    SOURCE_AMBIGUOUS,
    SOURCE_MISSING,
    Draft,
    stitch,
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


def test_a_coordinate_only_in_the_quoted_post_is_not_read():
    # It is the quoted author's geolocation, not the analyst's.
    quoted = QuotedTweet(
        tweet_id="2", handle="src", text="here 48.012345, 37.802411", created_at=""
    )
    assert _coords([_rec(text="geolocated this", quoted=quoted)]) == []


def test_coords_come_from_the_analysts_own_text():
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


def test_source_is_quoted_tweet_with_its_date():
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    url, posted = resolve_source([_rec(quoted=quoted)])
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_source_uses_the_sole_candidate_link():
    record = _rec(external_sources=[SourceLink(url="https://x.com/a/status/9")])
    url, posted = resolve_source([record])
    assert url == "https://x.com/a/status/9"
    assert posted is None


def test_source_is_host_blind():
    # An article, a TikTok, an Instagram reel: a sole link is the source
    # whatever the host, stored link-only because nothing chases it.
    for url in (
        "https://www.instagram.com/reel/FAKEREEL01/",
        "https://www.tiktok.com/@war/video/7",
        "https://example-news.test/2026/03/04/report",
    ):
        assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (url, None)


def test_source_none_when_several_candidate_links():
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/a/status/9"),
            SourceLink(url="https://t.me/c/1"),
        ]
    )
    assert resolve_source([record]) == (None, None)


def test_the_same_link_repeated_is_one_candidate():
    link = SourceLink(url="https://x.com/a/status/9")
    assert resolve_source([_rec(external_sources=[link, link])])[0] == "https://x.com/a/status/9"


def test_x_and_twitter_variants_of_one_status_are_one_candidate():
    # One status id spelled four ways is one candidate, not an ambiguity.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/a/status/9"),
            SourceLink(url="https://twitter.com/a/status/9"),
            SourceLink(url="https://x.com/a/status/9/"),
            SourceLink(url="https://x.com/a/status/9?s=20"),
        ]
    )
    assert resolve_source([record])[0] == "https://x.com/a/status/9"


def test_tracking_query_and_trailing_slash_do_not_split_a_candidate():
    record = _rec(
        external_sources=[
            SourceLink(url="https://t.me/chan/7"),
            SourceLink(url="https://t.me/chan/7/?utm_source=x"),
        ]
    )
    assert resolve_source([record])[0] == "https://t.me/chan/7"


def test_an_x_link_naming_no_status_is_excluded():
    # A profile link points at no post, so the status link beside it is the sole
    # candidate and wins the slot.
    record = _rec(
        external_sources=[
            SourceLink(url="https://x.com/osinttechnical"),
            SourceLink(url="https://x.com/osinttechnical/status/2028478401154084878"),
        ]
    )
    assert resolve_source([record])[0] == (
        "https://x.com/osinttechnical/status/2028478401154084878"
    )


def test_the_analysts_own_status_link_is_excluded():
    # The "previous geolocation" self-reference: a cross-reference, not a
    # source, so the third-party status is the sole candidate.
    record = _rec(
        handle="analyst",
        external_sources=[
            SourceLink(url="https://x.com/analyst/status/111"),
            SourceLink(url="https://x.com/CENTCOM"),
            SourceLink(url="https://x.com/CENTCOM/status/222"),
        ],
    )
    assert resolve_source([record])[0] == "https://x.com/CENTCOM/status/222"


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
        "https://www.google.com/maps/@48.012345,37.802411,15z",
        "https://maps.google.com/?q=48.012345,37.802411",
    ):
        assert resolve_source([_rec(external_sources=[SourceLink(url=url)])]) == (None, None)


def test_a_quote_outranks_a_candidate_link():
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    record = _rec(external_sources=[_INSTAGRAM], quoted=quoted)
    url, posted = resolve_source([record])
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_two_records_quoting_one_post_are_one_candidate():
    # A thread that repeats its quote (the analyst quote-tweets the same footage
    # twice) names one post, so the slot fills as a single quote would.
    quoted = QuotedTweet(tweet_id="222", handle="src", text="", created_at="2024-12-31T09:00:00Z")
    url, posted = resolve_source(
        [_rec(tweet_id="1", quoted=quoted), _rec(tweet_id="2", quoted=quoted)]
    )
    assert url == "https://x.com/src/status/222"
    assert posted == "2024-12-31T09:00:00Z"


def test_two_records_quoting_two_posts_leave_the_source_empty():
    # The same ambiguity as two candidate links: the engine will not pick, so
    # review does.
    first = QuotedTweet(tweet_id="222", handle="src_a", text="", created_at="2024-12-31T09:00:00Z")
    second = QuotedTweet(tweet_id="333", handle="src_b", text="", created_at="2025-01-02T10:00:00Z")
    thread = [_rec(tweet_id="1", quoted=first), _rec(tweet_id="2", quoted=second)]
    assert resolve_source(thread) == (None, None)


def test_source_none_when_no_quote_and_no_link():
    # The head's own post is provenance (detected_from_url), never a deduced
    # self-source.
    assert resolve_source([_rec()]) == (None, None)


def test_the_displaced_candidates_land_as_mirrors():
    record = _rec(
        text="Strike at 48.012345, 37.802411",
        external_sources=[_INSTAGRAM, SourceLink(url="https://x.com/a/status/9")],
    )
    draft = _draft([record])
    assert draft.source_url is None
    assert draft.secondary_source_urls == [_INSTAGRAM.url, "https://x.com/a/status/9"]


# ── Proof ─────────────────────────────────────────────────────────────────


def test_proof_keeps_a_reference_link_readable():
    # Raw tweet text carries only opaque t.co wrappers; the entity's expansion is
    # what keeps the link readable in the stored proof.
    record = _rec(
        text="Strike at 48.012345, 37.802411\nSource: https://t.co/fakeIG",
        external_sources=[_INSTAGRAM],
    )
    assert _draft([record]).proof_text.splitlines()[-1] == f"Source: {_INSTAGRAM.url}"


def test_proof_keeps_the_coordinate_line():
    draft = _draft([_rec(text="Strike on the depot\n48.012345, 37.802411")])
    assert draft.proof_text == "Strike on the depot\n48.012345, 37.802411"


# ── Media split ───────────────────────────────────────────────────────────


def test_split_media_promotes_the_first_own_video_to_source():
    # Nothing else can fill the source slot and the proof document embeds images
    # only, so leaving the video in proof would drop it at persistence.
    record = _rec(media=[_media("image", "op"), _media("video", "op"), _media("video", "op")])
    source, proof = split_media([record])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image", "video"]


def test_split_media_promotes_the_first_video_in_thread_order():
    head = _rec(tweet_id="1", media=[_media("video", "op")])
    reply = _rec(tweet_id="2", media=[_media("video", "op")])
    source, proof = split_media([head, reply])
    assert source == [head.media[0]]
    assert proof == [reply.media[0]]


def test_split_media_quote_keeps_precedence_over_an_own_video():
    # A quote is the source even when it carried no media at all, so the
    # analyst's own video stays annotation.
    quoted = QuotedTweet(tweet_id="2", handle="src", text="", created_at="")
    source, proof = split_media([_rec(media=[_media("video", "op")], quoted=quoted)])
    assert source == []
    assert [m.kind for m in proof] == ["video"]


def test_split_media_a_linked_source_makes_op_media_proof():
    # The analyst links a source, so their own media is annotation; the footage
    # is elsewhere (empty here, the chase would fill it).
    record = _rec(
        media=[_media("image", "op")],
        external_sources=[SourceLink(url="https://x.com/src/status/9")],
    )
    source, proof = split_media([record])
    assert source == []
    assert [m.kind for m in proof] == ["image"]


def test_split_media_quoted_is_source_op_is_proof():
    quoted = QuotedTweet(
        tweet_id="2", handle="src", text="", created_at="", media=[_media("video", "quote")]
    )
    source, proof = split_media([_rec(media=[_media("image", "op")], quoted=quoted)])
    assert [m.kind for m in source] == ["video"]
    assert [m.kind for m in proof] == ["image"]


def test_split_media_takes_the_footage_of_the_quoted_post_the_source_names():
    # The bug this rules out: the source names one quoted post and the source
    # slot holds another's video. Two quoted posts leave the source empty, so
    # the source media is empty too and neither video is filed under a post the
    # draft does not name; the analyst's own photo is still the annotation.
    first = QuotedTweet(
        tweet_id="222",
        handle="src_a",
        text="",
        created_at="",
        media=[_media("video", "quote")],
    )
    second = QuotedTweet(
        tweet_id="333",
        handle="src_b",
        text="",
        created_at="",
        media=[_media("video", "quote")],
    )
    thread = [
        _rec(tweet_id="1", quoted=first),
        _rec(tweet_id="2", media=[_media("image", "op")], quoted=second),
    ]
    source, proof = split_media(thread)
    assert source == []
    assert [m.kind for m in proof] == ["image"]


def test_two_quoted_posts_land_as_mirrors_and_warn_ambiguous():
    # The whole draft: no source, both quoted statuses kept for review, and the
    # warning that says why the slot is empty.
    first = QuotedTweet(tweet_id="222", handle="src_a", text="", created_at="")
    second = QuotedTweet(tweet_id="333", handle="src_b", text="", created_at="")
    draft = _draft(
        [
            _rec(tweet_id="1", text="Geolocated 48.012345, 37.802411", quoted=first),
            _rec(tweet_id="2", quoted=second),
        ]
    )
    assert draft.source_url is None
    assert draft.secondary_source_urls == [
        "https://x.com/src_a/status/222",
        "https://x.com/src_b/status/333",
    ]
    assert draft.warnings == [SOURCE_AMBIGUOUS]


def test_split_media_own_photo_is_proof_without_quote():
    # A photo is never promoted: it is a map crop, a screenshot, an annotation.
    source, proof = split_media([_rec(media=[_media("image", "op")])])
    assert source == []
    assert [m.kind for m in proof] == ["image"]


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


def test_a_coordinate_in_the_reply_keeps_the_head_as_provenance():
    # Head carries the video, the reply carries the coordinate: one draft with
    # the head's own post as provenance. The thread declares no source, so
    # source_url stays empty; the video fills the otherwise empty source media
    # slot, where the proof document (images only) would have dropped it.
    head = _rec(tweet_id="1", text="Footage from Bakhmut", media=[_media("video", "op")])
    reply = _rec(tweet_id="2", text="Geolocated: 48.592153, 38.002480")
    draft = _draft([head, reply])
    assert draft.detected_from_tweet_id == 1
    assert draft.detected_from_url == "https://x.com/analyst/status/1"
    assert draft.source_url is None
    assert [m.kind for m in draft.source_media] == ["video"]
    assert draft.proof_media == []


def test_proof_keeps_the_text_and_drops_the_media_wrapper():
    # The coordinate line stays: the analyst edits the proof at review, and the
    # structured field is not a reason to rewrite what they wrote.
    draft = _draft([_rec(text="Strike here 48.012345, 37.802411 https://t.co/abc123")])
    assert draft.proof_text == "Strike here 48.012345, 37.802411"


def test_title_is_never_a_bare_coordinate():
    # The only line is a coordinate alone, so no line qualifies and the analyst
    # types the title at review.
    assert _draft([_rec(text="48.012345, 37.802411")]).title == ""


def test_title_keeps_the_line_as_written():
    draft = _draft([_rec(text="#Ukraine strike at 48.012345, 37.802411 https://t.co/x")])
    assert draft.title == "#Ukraine strike at 48.012345, 37.802411 https://t.co/x"


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


def test_a_sourceless_draft_warns_source_missing():
    draft = _draft([_rec(text="Geolocated 48.012345, 37.802411 near the bridge")])
    assert draft.warnings == [SOURCE_MISSING]


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


def test_several_coordinates_warn_on_every_draft():
    drafts = _drafts([_rec(text="Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert len(drafts) == 2
    assert all(draft.warnings == [SEVERAL_COORDINATES, SOURCE_MISSING] for draft in drafts)


def test_a_sourced_draft_warns_nothing():
    quoted = QuotedTweet(tweet_id="2", handle="src", text="", created_at="")
    assert _draft([_rec(text="Geolocated 48.012345, 37.802411", quoted=quoted)]).warnings == []


def test_the_resolution_counts_what_its_drafts_carry():
    # The count the bot's reply and the archive's outcome email both read: one
    # per draft carrying the warning, not one per thread that raised it.
    resolution = _resolve([_rec(text="Two sites 48.012345, 37.802411 and 50.450100, 30.523400")])
    assert resolution.warnings == {SEVERAL_COORDINATES: 2, SOURCE_MISSING: 2}


def test_no_coordinate_is_refused_as_missing():
    resolution = _resolve([_rec(text="Just some commentary, no coords")])
    assert resolution.drafts == []
    assert resolution.reason == COORDS_MISSING


def test_an_empty_thread_is_refused_as_missing():
    assert _resolve([]).reason == COORDS_MISSING


def test_a_draft_carries_no_reason():
    resolution = _resolve([_rec(text="Geolocated 48.012345, 37.802411")])
    assert len(resolution.drafts) == 1
    assert resolution.reason is None


def test_a_retweet_produces_nothing():
    # The prefix means the words are someone else's, on every entry.
    resolution = _resolve([_rec(text="RT @front_cam: Geolocated 48.012345, 37.802411")])
    assert resolution.drafts == []
    assert resolution.reason == COORDS_MISSING


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


def test_an_archive_thread_resolves_over_its_stitched_records():
    # The archive spine (stitch then resolve): a coordinate in the head and
    # commentary in the reply land as one draft with combined proof.
    head = _rec(tweet_id="1", text="Geolocated 48.012345, 37.802411 near the bridge")
    reply = _rec(tweet_id="2", text="More context on the strike")
    reply = dataclasses.replace(reply, in_reply_to_status_id="1")
    [thread] = stitch([head, reply])
    draft = _draft(thread)
    assert draft.coordinate.lat == pytest.approx(48.012345)
    assert draft.detected_from_url == "https://x.com/analyst/status/1"
    assert "near the bridge" in draft.proof_text
    assert "More context on the strike" in draft.proof_text
