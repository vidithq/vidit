"""Parametrized contract check: each typology resolves to its expected shape.

Builds the geoloc tweet's record (or stitched thread) per typology, runs the
shared ``resolve_threads`` core, and asserts every derived field of every draft
against ``expected.json``. This is the offline unit boundary; the archive
integration lives in ``test_archive_contract``.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest

from app.services.tweet_ingest import COORDS_MISSING, Draft, chase_thread, resolve_threads
from app.services.tweet_ingest.records import (
    ParsedMedia,
    QuotedTweet,
    SourceLink,
    TelegramFootage,
    TweetRecord,
)

from . import loader

_COORD_PLACES = 6


def _draft(thread: list[TweetRecord]) -> Draft:
    """The single draft a one-coordinate thread resolves to."""
    [draft] = resolve_threads([thread]).drafts
    return draft


def _roles(media: list[Any]) -> list[list[str]]:
    return [[m.kind, m.origin] for m in media]


@pytest.mark.parametrize("typology", loader.typology_names())
def test_typology_resolves_to_expected(typology: str, tmp_path: Path) -> None:
    """One draft per coordinate the typology carries, each with the source,
    dates, title and media split the shared expectation names."""
    expected = loader.load_expected(typology)
    resolution = resolve_threads([loader.thread_for(typology, tmp_path)])

    assert [
        [round(d.coordinate.lat, _COORD_PLACES), round(d.coordinate.lng, _COORD_PLACES)]
        for d in resolution.drafts
    ] == [[round(lat, _COORD_PLACES), round(lng, _COORD_PLACES)] for lat, lng in expected["coords"]]
    for draft in resolution.drafts:
        assert draft.source_url == expected["source_url"]
        assert draft.secondary_source_urls == expected["secondary_source_urls"]
        assert draft.title == expected["title"]
        assert draft.warnings == expected["warnings"]
        assert _roles(draft.source_media) == [list(pair) for pair in expected["source_media"]]
        assert _roles(draft.proof_media) == [list(pair) for pair in expected["proof_media"]]

        expected_posted = expected["source_posted_at"]
        if expected_posted is None:
            assert draft.source_posted_at is None
        else:
            assert draft.source_posted_at == datetime.fromisoformat(expected_posted)

        expected_date = expected["event_date"]
        if expected_date is None:
            assert draft.event_date is None
        else:
            assert draft.event_date == date.fromisoformat(expected_date)


def test_x_status_link_chase_fills_source_from_chased_tweet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The archive chase branch: an X status link with no inline quote resolves
    its source from the chased tweet (its canonical url, date, and media), while
    the OP's own photo stays proof. The archive reader chases at read time; the
    live entries chase inside ``acquire_thread``, and both land on the shared
    expectation."""
    import app.services.tweet_ingest.archive as archive_mod
    import app.services.tweet_ingest.chase.x as x_chase_mod

    typology = "x_status_link"
    body = loader.load_body(typology)
    expected = loader.load_expected(typology)
    chased_body = loader.load_chased(typology, expected["chased_status_id"])

    # The OP as a single archive tweet carrying the x-status link + its photo.
    archive = tmp_path / "chase_archive"
    (archive / "tweets_media").mkdir(parents=True)
    entry, files = loader.archive_tweet_from_body(body)
    loader.write_archive_js(archive, [entry])
    for media_file in files:
        (archive / media_file.relative_path).write_bytes(media_file.data)

    def fake_fetch(tweet_id: str, *, client: Any = None) -> dict[str, Any]:
        assert tweet_id == expected["chased_status_id"]
        return chased_body

    monkeypatch.setattr(x_chase_mod, "fetch_syndication", fake_fetch)
    records = chase_thread(archive_mod.read_tweets(archive, handle=body["user"]["screen_name"]))

    draft = _draft(records)
    assert draft.source_url == expected["source_url"]
    assert draft.source_posted_at == datetime.fromisoformat(expected["source_posted_at"])
    assert _roles(draft.source_media) == [list(pair) for pair in expected["source_media"]]
    assert _roles(draft.proof_media) == [list(pair) for pair in expected["proof_media"]]


_TG_URL = "https://t.me/somechannel/12345"


def _telegram_record(
    telegram: TelegramFootage | None,
    *,
    extra_links: list[SourceLink] | None = None,
) -> TweetRecord:
    """A geoloc tweet linking a t.me post, with an optional chased footage.

    One OP photo (annotation) and a Telegram link. ``telegram`` is the chased
    embed (or ``None`` for the no-chase path); ``extra_links`` adds more links to
    exercise the ambiguity rule.
    """
    return TweetRecord(
        tweet_id="8400000000000000001",
        handle="osint_stork",
        text=f"Geolocated 44.612300, 33.522100 airfield perimeter\nSource: {_TG_URL}",
        created_at="2026-03-04T13:20:00+00:00",
        media=[ParsedMedia("image", "https://pbs.twimg.com/media/op.jpg", "image/jpeg", "op")],
        external_sources=[SourceLink(_TG_URL), *(extra_links or [])],
        telegram=telegram,
    )


def test_chased_telegram_fills_source_date_and_media() -> None:
    footage = TelegramFootage(
        url=_TG_URL,
        posted_at="2026-03-04T09:00:00+00:00",
        media=[
            ParsedMedia("video", "https://cdn4.cdn-telegram.org/file/v.mp4", "video/mp4", "quote")
        ],
    )
    draft = _draft([_telegram_record(footage)])
    assert draft.source_url == _TG_URL
    assert draft.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    assert _roles(draft.source_media) == [["video", "quote"]]
    assert _roles(draft.proof_media) == [["image", "op"]]


def test_chased_telegram_sensitive_is_date_only() -> None:
    footage = TelegramFootage(url=_TG_URL, posted_at="2026-03-04T09:00:00+00:00", media=[])
    draft = _draft([_telegram_record(footage)])
    assert draft.source_url == _TG_URL
    assert draft.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    assert draft.source_media == []
    assert _roles(draft.proof_media) == [["image", "op"]]


def test_unchased_telegram_link_is_link_only() -> None:
    """The no-chase path (record carries no footage): link source, no date, no
    source media, the ``telegram_link`` contract."""
    draft = _draft([_telegram_record(None)])
    assert draft.source_url == _TG_URL
    assert draft.source_posted_at is None
    assert draft.source_media == []


def test_two_candidate_links_leave_the_source_empty() -> None:
    """Two candidate links make the source ambiguous; even a chased Telegram
    footage is dropped and the source stays empty for review."""
    footage = TelegramFootage(url=_TG_URL, posted_at="2026-03-04T09:00:00+00:00", media=[])
    record = _telegram_record(
        footage,
        extra_links=[SourceLink("https://www.youtube.com/watch?v=FAKEVIDEO01")],
    )
    draft = _draft([record])
    assert draft.source_url is None
    assert draft.source_posted_at is None
    assert draft.source_media == []
    # No primary was picked, so both candidates land as mirrors and the owner
    # promotes one at review rather than losing them.
    assert draft.secondary_source_urls == [
        _TG_URL,
        "https://www.youtube.com/watch?v=FAKEVIDEO01",
    ]


def test_second_link_becomes_a_secondary_source() -> None:
    """A quoted footage tweet outranks links and takes the source slot; the
    mirror the OP also linked lands as a secondary source."""
    record = TweetRecord(
        tweet_id="8400000000000000009",
        handle="osint_stork",
        text=f"Geolocated 44.612300, 33.522100 airfield perimeter\nMirror: {_TG_URL}",
        created_at="2026-03-04T13:20:00+00:00",
        external_sources=[SourceLink(_TG_URL)],
        quoted=QuotedTweet(
            tweet_id="8400000000000000002",
            handle="front_cam",
            text="raw footage",
            created_at="2026-03-04T09:00:00+00:00",
        ),
    )
    draft = _draft([record])
    assert draft.source_url == "https://x.com/front_cam/status/8400000000000000002"
    assert draft.secondary_source_urls == [_TG_URL]


def _links_record(links: list[SourceLink]) -> TweetRecord:
    """A geoloc tweet carrying ``links`` and nothing else that could source it."""
    return TweetRecord(
        tweet_id="8400000000000000010",
        handle="osint_stork",
        text="Geolocated 44.612300, 33.522100 airfield perimeter",
        created_at="2026-03-04T13:20:00+00:00",
        external_sources=links,
    )


def test_primary_link_is_not_repeated_as_a_secondary() -> None:
    """The source link written in another spelling (``twitter.com``, a tracking
    query) is the primary, not a mirror of it."""
    status = "https://x.com/source_gull/status/8500000000000000002"
    draft = _draft(
        [
            _links_record(
                [
                    SourceLink(f"{status}?s=20"),
                    SourceLink("https://twitter.com/source_gull/status/8500000000000000002"),
                    SourceLink(status),
                ]
            )
        ]
    )
    assert draft.source_url == f"{status}?s=20"
    assert draft.secondary_source_urls == []


def test_tracking_query_spelling_of_the_primary_is_not_a_mirror() -> None:
    """The identity strip is what drops it: same video id, share provenance only
    in the query, so the second spelling is one link and the slot is not
    ambiguous."""
    video = "https://www.youtube.com/watch?v=FAKEVIDEO01"
    draft = _draft(
        [_links_record([SourceLink(video), SourceLink(f"{video}&si=abc123&utm_source=x")])]
    )
    assert draft.source_url == video
    assert draft.secondary_source_urls == []


def test_distinct_videos_sharing_a_path_are_two_candidates() -> None:
    """Two YouTube ids on the one ``/watch`` path are two links, so the source is
    ambiguous and both land as mirrors: one identity rule, and it reads the
    query because that is where the video id lives."""
    first = "https://www.youtube.com/watch?v=FAKEVIDEO01"
    second = "https://www.youtube.com/watch?v=FAKEVIDEO02"
    draft = _draft([_links_record([SourceLink(first), SourceLink(second)])])
    assert draft.source_url is None
    assert draft.secondary_source_urls == [first, second]


def test_a_maps_link_is_never_a_source() -> None:
    """A Google Maps link is where the coordinate came from, not the footage, so
    it is excluded from the candidates and the thread stays sourceless."""
    draft = _draft(
        [_links_record([SourceLink("https://www.google.com/maps/@44.6123,33.5221,15z")])]
    )
    assert draft.source_url is None
    assert draft.secondary_source_urls == []


def test_an_article_link_is_a_source() -> None:
    """Host-blind: a link on no chase-vocabulary host is a candidate like any
    other, so a sole article link fills the slot link-only."""
    article = "https://example-news.test/2026/03/04/strike-report"
    draft = _draft([_links_record([SourceLink(article)])])
    assert draft.source_url == article
    assert draft.source_posted_at is None


def test_a_retweet_produces_nothing() -> None:
    """A post opening on the retweet prefix carries someone else's words, so the
    engine reads no thread at all."""
    record = _links_record([])
    retweet = TweetRecord(
        tweet_id=record.tweet_id,
        handle=record.handle,
        text=f"RT @front_cam: {record.text}",
        created_at=record.created_at,
    )
    resolution = resolve_threads([[retweet]])
    assert resolution.drafts == []
    assert resolution.refusals == {COORDS_MISSING: 1}


def test_every_typology_has_both_fixture_files() -> None:
    """Guard the catalogue: each typology ships a body and an expected file so a
    half-added typology fails loudly here, not as a confusing KeyError later."""
    for typology in loader.typology_names():
        assert (loader.FIXTURES_DIR / typology / "body.json").is_file()
        assert (loader.FIXTURES_DIR / typology / "expected.json").is_file()


_ENTRY_PATHS = ("bot", "paste", "archive")


def test_no_entry_answers_a_typology_differently() -> None:
    """The gate of the one-grammar rework: the three entries read one grammar,
    so no ``paths.<entry>`` block may override what a typology resolves to. A
    block may only pin that entry's own vocabulary (the bot's failure reason) or
    skip a shape it cannot be pointed at."""
    for typology in loader.typology_names():
        paths = loader.load_expected(typology).get("paths", {})
        assert set(paths) <= set(_ENTRY_PATHS), typology
        for entry, block in paths.items():
            assert set(block) <= {"reason", "skip"}, f"{typology}: {entry} overrides the grammar"


def test_every_skip_carries_its_reason() -> None:
    """A declared gap says why in prose, which is what makes the declaration
    worth more than a name left out of a test module."""
    for typology in loader.typology_names():
        for entry, block in loader.load_expected(typology).get("paths", {}).items():
            skip = block.get("skip")
            if skip is not None:
                assert isinstance(skip, str) and len(skip) > 40, f"{typology}: {entry}"
