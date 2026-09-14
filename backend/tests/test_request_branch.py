"""The engine's second exit: which coordinate-less threads draft a request.

Pure, no DB. The three shapes that do draft one are pinned typology by typology
in ``tests/ingest_contract`` (``mirror_telegram_no_coord``,
``mirror_x_status_no_coord``, ``mirror_other_host_no_coord``); what is left here
is the boundary, the threads that look request-shaped and are not, because each
of the six conditions in ``resolve._request_draft`` has to be the one that
refuses them, plus the one spelling the source is stored under. The one shape
that rules a request out for good, a source pointed at and no footage to store,
also names itself back
(``request_not_possible``); the five a re-tag or a rewrite can still clear do
not.

The refusal always travels with the draft, so every case below also asserts
that the thread still reports ``coords_missing``: an entry reading detections
alone (the paste, the archive) answers exactly what it did before.
"""

from __future__ import annotations

from app.services.tweet_ingest import (
    COORDS_INVALID,
    COORDS_MISSING,
    REQUEST_NOT_POSSIBLE,
    RequestDraft,
)
from app.services.tweet_ingest.records import ParsedMedia, QuotedTweet, SourceLink, TweetRecord
from app.services.tweet_ingest.resolve import resolve_threads
from tests._fixtures import tweet_record

_TELEGRAM = SourceLink(url="https://t.me/wilddivision82/351", shortlink="https://t.co/fakeTG")
_YOUTUBE = SourceLink(
    url="https://www.youtube.com/watch?v=FAKEVIDEO01", shortlink="https://t.co/fakeYT"
)
_TIKTOK = SourceLink(url="https://www.tiktok.com/@war/video/7", shortlink="https://t.co/fakeTT")
_OWN_STATUS = SourceLink(url="https://x.com/analyst/status/17", shortlink="https://t.co/fakeOWN")
_X_PROFILE = SourceLink(url="https://x.com/front_owl", shortlink="https://t.co/fakePRO")

_VIDEO = ParsedMedia(kind="video", remote_url="https://video.twimg.com/v.mp4", origin="op")

# The motivating post, as it was actually written: the analyst's words, the
# channel's link and the re-uploaded clip, all on one line and with no
# coordinate anywhere.
_MIRROR_TEXT = 'Trabajo de "Wild Division" de la 82ª Brigada https://t.co/fakeTG'


def _rec(**kw: object) -> TweetRecord:
    """The shared builder under this module's own mirror-post identity."""
    return tweet_record(
        **{"tweet_id": "9200000000000000001", "created_at": "2026-03-12T08:30:00Z", **kw}
    )


def _draft(thread: list[TweetRecord]) -> RequestDraft | None:
    """The one draft the thread yields, ``None`` when it yields none.

    Asserts the refusal alongside, since the branch adds an exit and moves no
    existing one.
    """
    resolution = resolve_threads([thread], with_requests=True)
    assert resolution.detections == []
    assert resolution.reason == COORDS_MISSING
    return resolution.requests[0] if resolution.requests else None


def test_a_mirror_post_with_a_telegram_link_and_a_video_drafts_a_request() -> None:
    """The motivating shape, with the link and the words on one line: the t.me
    post is the source, the attached clip is the footage, and the title is the
    line as the analyst wrote it, the link included."""
    draft = _draft([_rec(text=_MIRROR_TEXT, media=[_VIDEO], external_sources=[_TELEGRAM])])

    assert draft is not None
    assert draft.source_url == "https://t.me/wilddivision82/351"
    assert draft.footage_candidates == [_VIDEO]
    assert draft.title.startswith('Trabajo de "Wild Division"')
    assert draft.detected_from_tweet_id == 9200000000000000001
    assert draft.detected_from_url == "https://x.com/analyst/status/9200000000000000001"
    # The chase served nothing here (a pure thread fetches nothing), so the
    # source's date is unknown and the write path says so at review.
    assert draft.source_posted_at is None


def test_a_sole_link_off_the_chase_vocabulary_drafts_over_the_own_video() -> None:
    """A source is a source whatever its host. Nothing chases a YouTube link, so
    the analyst's own clip is the footage and the source's date is unknown; the
    link is stored as the post wrote it, since nothing here knows which half of
    such a URL names the post."""
    draft = _draft(
        [
            _rec(
                text="Clip worth a look\nhttps://t.co/fakeYT",
                media=[_VIDEO],
                external_sources=[_YOUTUBE],
            )
        ]
    )

    assert draft is not None
    assert draft.source_url == "https://www.youtube.com/watch?v=FAKEVIDEO01"
    assert draft.footage_candidates == [_VIDEO]
    assert draft.source_posted_at is None


def test_a_video_with_no_link_and_no_quote_drafts_nothing() -> None:
    """No source at all: the analyst posted footage and said nothing about where
    it came from, which is the shape a request must not invent a source for."""
    assert _draft([_rec(text="Something is burning out there", media=[_VIDEO])]) is None


def test_a_telegram_link_with_no_footage_anywhere_drafts_nothing() -> None:
    """A request carries its poster's evidence from the start
    (``events.create_request`` requires a file), so a thread naming a source and
    carrying nothing to store is a refusal."""
    assert (
        _draft([_rec(text="Worth reading\nhttps://t.co/fakeTG", external_sources=[_TELEGRAM])])
        is None
    )


def test_a_photo_is_not_promoted_into_the_footage_slot() -> None:
    """The media split never promotes an analyst's photo (a map crop, a
    screenshot), so a thread whose only own media is one leaves the footage slot
    empty and drafts nothing."""
    photo = ParsedMedia(kind="image", remote_url="https://pbs.twimg.com/media/x.jpg", origin="op")
    assert (
        _draft(
            [
                _rec(
                    text="Worth reading\nhttps://t.co/fakeTG",
                    media=[photo],
                    external_sources=[_TELEGRAM],
                )
            ]
        )
        is None
    )


def test_a_blank_title_drafts_nothing() -> None:
    """``create_request`` requires a title, and the engine never invents one: a
    post that is nothing but its link has no line carrying text."""
    assert (
        _draft([_rec(text="https://t.co/fakeTG", media=[_VIDEO], external_sources=[_TELEGRAM])])
        is None
    )


def test_an_out_of_bounds_coordinate_drafts_nothing() -> None:
    """``coords_invalid`` is a typo the analyst can fix, not a post with no
    coordinate: the draft rides the ``coords_missing`` leg alone, so this thread
    keeps the refusal it earns and offers nothing else."""
    thread = [
        _rec(
            text="Strike at 91.000000, 200.000000\nhttps://t.co/fakeTG",
            media=[_VIDEO],
            external_sources=[_TELEGRAM],
        )
    ]
    resolution = resolve_threads([thread], with_requests=True)

    assert resolution.detections == []
    assert resolution.reason == COORDS_INVALID
    assert resolution.requests == []


def test_a_link_back_to_the_analysts_own_status_drafts_nothing() -> None:
    """An own-status link is a cross-reference, never a source, so the thread
    declares none and the branch has nothing to name."""
    assert (
        _draft(
            [
                _rec(
                    text="As I said here\nhttps://t.co/fakeOWN",
                    media=[_VIDEO],
                    external_sources=[_OWN_STATUS],
                )
            ]
        )
        is None
    )


def test_an_x_profile_link_drafts_nothing() -> None:
    """On X footage lives at a status and nowhere else, so a profile link
    credits an author and points the source slot at nothing."""
    assert (
        _draft(
            [
                _rec(
                    text="Credit to this account\nhttps://t.co/fakePRO",
                    media=[_VIDEO],
                    external_sources=[_X_PROFILE],
                )
            ]
        )
        is None
    )


def test_two_candidate_links_draft_nothing() -> None:
    """An ambiguous source leaves the slot empty for review, and an empty slot
    is not a source a request can name."""
    assert (
        _draft(
            [
                _rec(
                    text="Two places to look\nhttps://t.co/fakeTG\nhttps://t.co/fakeYT",
                    media=[_VIDEO],
                    external_sources=[_TELEGRAM, _YOUTUBE],
                )
            ]
        )
        is None
    )


def test_a_quoted_status_carrying_footage_drafts_a_request() -> None:
    """A quote is a source the analyst declared by quoting, and a quoted X
    status opens a request exactly as a linked one does: the footage is the
    quoted post's, and its date comes free."""
    quote = QuotedTweet(
        tweet_id="9200000000000000002",
        handle="front_owl",
        text="Column moving at first light",
        created_at="2026-03-11T18:40:00.000Z",
        media=[
            ParsedMedia(kind="video", remote_url="https://video.twimg.com/q.mp4", origin="quote")
        ],
    )
    draft = _draft([_rec(text="Worth a look at this", quoted=quote)])

    assert draft is not None
    assert draft.source_url == "https://x.com/front_owl/status/9200000000000000002"
    assert [m.origin for m in draft.footage_candidates] == ["quote"]
    assert draft.source_posted_at is not None


def test_a_post_id_the_column_cannot_hold_drafts_nothing() -> None:
    """The provenance id is the leg a repeat mention matches on, so a draft
    without a usable one would open a second request on the next tag. No
    adapter writes such an id; the engine refuses it rather than trusting that.
    """
    assert (
        _draft(
            [
                _rec(
                    tweet_id="not-a-post-id",
                    text="Worth reading\nhttps://t.co/fakeTG",
                    media=[_VIDEO],
                    external_sources=[_TELEGRAM],
                )
            ]
        )
        is None
    )


def test_a_coordinate_in_the_quoted_post_drafts_nothing() -> None:
    """A coordinate anywhere in the thread, own post or quoted post, is a
    geolocation, never a request.

    The analyst's own text carries none, so nothing is detected (the coordinate
    is the quoted party's), and the quoted status is a source carrying footage. Opening a request over it would ask the board to
    geolocate footage that is already geolocated one post down, so the thread
    keeps the refusal it earns.
    """
    quote = QuotedTweet(
        tweet_id="9200000000000000002",
        handle="raw_feed",
        text="Vehicles burning at 48.123456, 37.654321",
        created_at="2026-03-11T18:40:00.000Z",
        media=[
            ParsedMedia(kind="video", remote_url="https://video.twimg.com/q.mp4", origin="quote")
        ],
    )
    assert _draft([_rec(text="Geolocated the clip below", quoted=quote)]) is None


def test_two_spellings_of_one_telegram_post_draft_one_source_url() -> None:
    """The source is stored canonical, never as the analyst spelled it.

    The dedup that keeps a re-tag off a second row compares ``source_url`` as a
    string (``detection._match_legs``), so a ``www.`` host and a share
    parameter have to reach the column as the same value the bare link does.
    """
    spellings = [
        "https://t.me/wilddivision82/351",
        "https://www.t.me/wilddivision82/351?single",
        "http://t.me/wilddivision82/351?comment=9",
    ]
    stored = set()
    for index, url in enumerate(spellings):
        link = SourceLink(url=url, shortlink=f"https://t.co/fakeTG{index}")
        draft = _draft(
            [
                _rec(
                    text=f"Channel footage worth a look\nhttps://t.co/fakeTG{index}",
                    media=[_VIDEO],
                    external_sources=[link],
                )
            ]
        )
        assert draft is not None
        stored.add(draft.source_url)

    assert stored == {"https://t.me/wilddivision82/351"}


def test_an_x_status_link_is_stored_canonical() -> None:
    """The same rule on the other technology: the tracking parameter and the
    ``twitter.com`` host come off, so one status is one source URL."""
    link = SourceLink(
        url="https://twitter.com/front_owl/status/9200000000000000002?s=20",
        shortlink="https://t.co/fakeXS",
    )
    draft = _draft(
        [_rec(text="Worth a look\nhttps://t.co/fakeXS", media=[_VIDEO], external_sources=[link])]
    )

    assert draft is not None
    assert draft.source_url == "https://x.com/front_owl/status/9200000000000000002"


def test_a_transient_chase_failure_drafts_nothing() -> None:
    """The upstream would not answer and the retry schedule is spent.

    The source's own footage may well exist, so a request opened now would
    store the analyst's copy under a post nobody read, and the dedup would keep
    the re-tag that could fix it off the row. The thread keeps its refusal and
    the next tag retries.
    """
    assert (
        _draft(
            [
                _rec(
                    text="Channel footage worth a look\nhttps://t.co/fakeTG",
                    media=[_VIDEO],
                    external_sources=[_TELEGRAM],
                    chase_outcome="transient_failure",
                )
            ]
        )
        is None
    )


def test_a_definitive_chase_failure_drafts_a_request_with_footage_and_no_warning() -> None:
    """The upstream answered and had nothing to take: the post is gone or
    restricted, so the analyst's own copy backs the footage slot instead. The
    row this drafts is never footage-less, so the draft itself carries no
    warning for it: only ``source_date_unknown`` reaches the analyst, raised
    later by ``detection._write_warnings`` because the chase served no date
    either. ``source_fetch_failed`` names why the source slot would be
    footage-less if it ever were, not something this row shows."""
    draft = _draft(
        [
            _rec(
                text="Channel footage worth a look\nhttps://t.co/fakeTG",
                media=[_VIDEO],
                external_sources=[_TELEGRAM],
                chase_outcome="not_accessible",
            )
        ]
    )

    assert draft is not None
    assert draft.warnings == []
    assert draft.source_fetch_failed is True
    assert draft.source_posted_at is None
    assert draft.footage_candidates == [_VIDEO]


def test_a_coordinate_behind_a_shortlink_in_a_quoted_post_drafts_nothing() -> None:
    """A quoted post's raw text carries only opaque ``t.co`` wrappers, so the
    coordinate guard expands them first: a maps link in the quoted post is the
    quoting party's geolocation to read, not a request to open."""
    quote = QuotedTweet(
        tweet_id="9200000000000000002",
        handle="raw_feed",
        text="Vehicles burning here https://t.co/fakeMAP",
        created_at="2026-03-11T18:40:00.000Z",
        media=[
            ParsedMedia(kind="video", remote_url="https://video.twimg.com/q.mp4", origin="quote")
        ],
        external_sources=[
            SourceLink(
                url="https://www.google.com/maps/@48.123456,37.654321,15z",
                shortlink="https://t.co/fakeMAP",
            )
        ],
    )
    assert _draft([_rec(text="Someone please locate this", quoted=quote)]) is None


def test_the_own_video_rides_behind_the_sources_footage_as_a_fallback() -> None:
    """The write path takes the first candidate that fetches, so the order is
    the contract: the source's footage, then the analyst's own copy for the
    fetch that comes back with nothing."""
    quote = QuotedTweet(
        tweet_id="9200000000000000002",
        handle="front_owl",
        text="Column moving at first light",
        created_at="2026-03-11T18:40:00.000Z",
        media=[
            ParsedMedia(kind="video", remote_url="https://video.twimg.com/q.mp4", origin="quote")
        ],
    )
    draft = _draft([_rec(text="Worth a look at this", media=[_VIDEO], quoted=quote)])

    assert draft is not None
    assert [media.origin for media in draft.footage_candidates] == ["quote", "op"]


def _request_reason(thread: list[TweetRecord]) -> str | None:
    """Why no request opened, as the bot reads it off the resolution.

    Asserts the two invariants the code must not move while it says more: the
    thread still refuses ``coords_missing``, and the entries that never ask for
    requests (the paste, the archive) still see no reason at all.
    """
    resolution = resolve_threads([thread], with_requests=True)
    assert resolution.reason == COORDS_MISSING
    assert resolve_threads([thread]).request_refusals == {}
    return resolution.request_reason


def test_a_source_off_the_chase_vocabulary_and_no_own_clip_names_why() -> None:
    """Nothing chases a TikTok link, so the only footage such a thread can offer
    is the analyst's own, and this one attached none. ``coords_missing`` is true
    of the post and hides that, so the branch names what to attach."""
    assert (
        _request_reason(
            [_rec(text="Clip worth a look\nhttps://t.co/fakeTT", external_sources=[_TIKTOK])]
        )
        == REQUEST_NOT_POSSIBLE
    )


def test_a_chased_source_with_no_footage_names_why_no_request_opened() -> None:
    """The same on a host the chase does read: the t.me post served no media and
    the analyst attached none, so the thread has nothing to store as the
    request's evidence."""
    assert (
        _request_reason(
            [_rec(text="Worth reading\nhttps://t.co/fakeTG", external_sources=[_TELEGRAM])]
        )
        == REQUEST_NOT_POSSIBLE
    )


def test_a_thread_pointing_at_no_source_keeps_the_plain_refusal() -> None:
    """The analyst posted footage and said nothing about where it came from, so
    there is no request shape to explain back: what their post lacks is the
    coordinate, which is what the refusal has always said."""
    assert _request_reason([_rec(text="Something is burning out there", media=[_VIDEO])]) is None


def test_a_transient_chase_failure_keeps_the_plain_refusal() -> None:
    """The next tag can still read that source, so naming the thread as one no
    request can ever serve would be wrong."""
    assert (
        _request_reason(
            [
                _rec(
                    text="Channel footage worth a look\nhttps://t.co/fakeTG",
                    media=[_VIDEO],
                    external_sources=[_TELEGRAM],
                    chase_outcome="transient_failure",
                )
            ]
        )
        is None
    )


def test_a_coordinate_in_the_quoted_post_keeps_the_plain_refusal() -> None:
    """The source is there and so is the footage: what stops the
    request is the coordinate one post down, so the analyst is told their own
    text carries none."""
    quote = QuotedTweet(
        tweet_id="9200000000000000002",
        handle="raw_feed",
        text="Vehicles burning at 48.123456, 37.654321",
        created_at="2026-03-11T18:40:00.000Z",
        media=[
            ParsedMedia(kind="video", remote_url="https://video.twimg.com/q.mp4", origin="quote")
        ],
    )
    assert _request_reason([_rec(text="Geolocated the clip below", quoted=quote)]) is None


def test_a_blank_title_keeps_the_plain_refusal() -> None:
    """A post that is nothing but its link is not a shape to explain back: the
    analyst wrote no line at all."""
    assert (
        _request_reason(
            [_rec(text="https://t.co/fakeTG", media=[_VIDEO], external_sources=[_TELEGRAM])]
        )
        is None
    )


def test_a_post_id_the_column_cannot_hold_keeps_the_plain_refusal() -> None:
    """No adapter writes such an id, so there is nothing for the analyst to
    act on and the refusal stays the one it has always been."""
    assert (
        _request_reason(
            [
                _rec(
                    tweet_id="not-a-post-id",
                    text="Worth reading\nhttps://t.co/fakeTG",
                    media=[_VIDEO],
                    external_sources=[_TELEGRAM],
                )
            ]
        )
        is None
    )
