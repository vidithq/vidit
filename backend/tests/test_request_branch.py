"""The engine's second exit: which coordinate-less threads draft a request.

Pure, no DB. The two shapes that do draft one are pinned typology by typology
in ``tests/ingest_contract`` (``mirror_telegram_no_coord``,
``mirror_x_status_no_coord``); what is left here is the boundary, the threads
that look request-shaped and are not, because each of the four conditions in
``resolve._request_draft`` has to be the one that refuses them.

The refusal always travels with the draft, so every case below also asserts
that the thread still reports ``coords_missing``: an entry reading detections
alone (the paste, the archive) answers exactly what it did before.
"""

from __future__ import annotations

from app.services.tweet_ingest import COORDS_INVALID, COORDS_MISSING, RequestDraft
from app.services.tweet_ingest.records import ParsedMedia, QuotedTweet, SourceLink, TweetRecord
from app.services.tweet_ingest.resolve import resolve_threads

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
    base: dict = dict(
        tweet_id="9200000000000000001",
        handle="analyst",
        text="",
        created_at="2026-03-12T08:30:00Z",
    )
    base.update(kw)
    return TweetRecord(**base)


def _draft(thread: list[TweetRecord]) -> RequestDraft | None:
    """The one draft the thread yields, ``None`` when it yields none.

    Asserts the refusal alongside, since the branch adds an exit and moves no
    existing one.
    """
    resolution = resolve_threads([thread])
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
    assert draft.footage == _VIDEO
    assert draft.title.startswith('Trabajo de "Wild Division"')
    assert draft.detected_from_tweet_id == 9200000000000000001
    assert draft.detected_from_url == "https://x.com/analyst/status/9200000000000000001"
    # The chase served nothing here (a pure thread fetches nothing), so the
    # source's date is unknown and the write path says so at review.
    assert draft.source_posted_at is None


def test_a_sole_youtube_link_drafts_nothing() -> None:
    """Every link is a source candidate, but only the two the chase reads name a
    post a request can be opened against. A YouTube link is a source and still
    a refusal."""
    assert (
        _draft(
            [
                _rec(
                    text="Clip worth a look\nhttps://t.co/fakeYT",
                    media=[_VIDEO],
                    external_sources=[_YOUTUBE],
                )
            ]
        )
        is None
    )


def test_a_sole_tiktok_link_drafts_nothing() -> None:
    assert (
        _draft(
            [
                _rec(
                    text="Clip worth a look\nhttps://t.co/fakeTT",
                    media=[_VIDEO],
                    external_sources=[_TIKTOK],
                )
            ]
        )
        is None
    )


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
    resolution = resolve_threads([thread])

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
    status is as requestable as a linked one: the footage is the quoted post's,
    and its date comes free."""
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
    assert draft.footage.origin == "quote"
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
    is the quoted party's), and the quoted status is a requestable source
    carrying footage. Opening a request over it would ask the board to
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
