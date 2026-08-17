"""Parametrized contract check: each typology resolves to its expected shape.

Builds the geoloc tweet's record (or stitched thread) per typology, runs the
shared ``resolve_thread`` core, and asserts every derived field against
``expected.json``. This is the offline unit boundary; the archive integration
lives in ``test_archive_contract``.
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest

from app.services.tweet_ingest import detect
from app.services.tweet_ingest.records import (
    QuotedTweet,
    SourceLink,
    TelegramFootage,
    TweetRecord,
)
from app.services.tweet_ingest.resolve import ResolvedTweet, resolve_thread
from app.services.tweet_ingest.syndication import ParsedMedia

from . import loader

_COORD_PLACES = 6


def _resolved_for(typology: str, tmp_path: Path) -> ResolvedTweet:
    resolved = resolve_thread(loader.thread_for(typology, tmp_path))
    assert resolved is not None, f"{typology}: resolve_thread returned None"
    return resolved


def _rounded(coords: list[Any]) -> list[list[float]]:
    return [[round(c.lat, _COORD_PLACES), round(c.lng, _COORD_PLACES)] for c in coords]


def _roles(media: list[Any]) -> list[list[str]]:
    return [[m.kind, m.origin] for m in media]


def _assert_matches(resolved: ResolvedTweet, expected: dict[str, Any]) -> None:
    assert _rounded(resolved.coords) == [
        [round(lat, _COORD_PLACES), round(lng, _COORD_PLACES)] for lat, lng in expected["coords"]
    ]
    assert resolved.source_url == expected["source_url"]
    assert resolved.secondary_source_urls == expected["secondary_source_urls"]

    expected_posted = expected["source_posted_at"]
    if expected_posted is None:
        assert resolved.source_posted_at is None
    else:
        assert resolved.source_posted_at == datetime.fromisoformat(expected_posted)

    expected_date = expected["event_date"]
    if expected_date is None:
        assert resolved.event_date is None
    else:
        assert resolved.event_date == date.fromisoformat(expected_date)

    assert resolved.title == expected["title"]
    assert _roles(resolved.source_media) == [list(pair) for pair in expected["source_media"]]
    assert _roles(resolved.proof_media) == [list(pair) for pair in expected["proof_media"]]


@pytest.mark.parametrize("typology", loader.typology_names())
def test_typology_resolves_to_expected(typology: str, tmp_path: Path) -> None:
    resolved = _resolved_for(typology, tmp_path)
    _assert_matches(resolved, loader.load_expected(typology))


@pytest.mark.parametrize("typology", loader.typology_names())
def test_detect_fans_one_dto_per_coordinate(typology: str, tmp_path: Path) -> None:
    """``detect`` emits exactly one DTO per resolved coordinate, each carrying
    the same source and proof the resolution produced."""
    expected = loader.load_expected(typology)
    dtos = detect(loader.thread_for(typology, tmp_path))
    assert len(dtos) == len(expected["coords"])
    for dto in dtos:
        assert dto.source_url == expected["source_url"]
        assert dto.secondary_source_urls == expected["secondary_source_urls"]
        assert _roles(dto.source_media) == [list(pair) for pair in expected["source_media"]]
        assert _roles(dto.proof_media) == [list(pair) for pair in expected["proof_media"]]
        assert dto.title == expected["title"]


def test_x_status_link_chase_fills_source_from_chased_tweet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The archive chase branch: an X status link with no inline quote resolves
    its source from the chased tweet (its canonical url, date, and media), while
    the OP's own photo stays proof. Exercises the ``from``-imported
    ``acquire.fetch_syndication`` seam the plan flags."""
    import app.services.tweet_ingest.acquire as acquire_mod
    import app.services.tweet_ingest.archive as archive_mod

    typology = "x_status_link"
    body = loader.load_body(typology)
    expected = loader.load_expected(typology)
    chase = expected["chase"]
    chased_body = loader.load_chased(typology, chase["linked_status_id"])

    # The OP as a single archive tweet carrying the x-status link + its photo.
    archive = tmp_path / "chase_archive"
    (archive / "tweets_media").mkdir(parents=True)
    entry, files = loader.archive_tweet_from_body(body)
    loader.write_archive_js(archive, [entry])
    for media_file in files:
        (archive / media_file.relative_path).write_bytes(media_file.data)

    def fake_fetch(tweet_id: str, *, client: Any = None) -> dict[str, Any]:
        assert tweet_id == chase["linked_status_id"]
        return chased_body

    monkeypatch.setattr(acquire_mod, "fetch_syndication", fake_fetch)
    records = archive_mod.read_tweets(archive, handle=body["user"]["screen_name"], chase=True)

    resolved = resolve_thread(records)
    assert resolved is not None
    assert resolved.source_url == chase["source_url"]
    assert resolved.source_posted_at == datetime.fromisoformat(chase["source_posted_at"])
    assert _roles(resolved.source_media) == [list(pair) for pair in chase["source_media"]]
    assert _roles(resolved.proof_media) == [list(pair) for pair in chase["proof_media"]]


_TG_URL = "https://t.me/somechannel/12345"


def _telegram_record(
    telegram: TelegramFootage | None,
    *,
    extra_links: list[SourceLink] | None = None,
    designated: bool = True,
) -> TweetRecord:
    """A geoloc tweet linking a t.me post, with an optional chased footage.

    One OP photo (annotation) and a Telegram footage link. ``telegram`` is the
    chased embed (or ``None`` for the no-chase path); ``extra_links`` adds more
    footage links to exercise the ambiguity rule; ``designated`` writes the link
    on a ``Source:`` line, the explicit designation that outranks that rule.
    """
    reference = f"Source: {_TG_URL}" if designated else f"Footage doing the rounds: {_TG_URL}"
    return TweetRecord(
        tweet_id="8400000000000000001",
        handle="osint_stork",
        text=f"Geolocated 44.612300, 33.522100 airfield perimeter\n{reference}",
        created_at="2026-03-04T13:20:00+00:00",
        permalink="https://x.com/osint_stork/status/8400000000000000001",
        media=[ParsedMedia("image", "https://pbs.twimg.com/media/op.jpg", "image/jpeg", "op")],
        external_sources=[SourceLink(_TG_URL, "telegram"), *(extra_links or [])],
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
    resolved = resolve_thread([_telegram_record(footage)])
    assert resolved is not None
    assert resolved.source_url == _TG_URL
    assert resolved.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    assert _roles(resolved.source_media) == [["video", "quote"]]
    assert _roles(resolved.proof_media) == [["image", "op"]]


def test_chased_telegram_sensitive_is_date_only() -> None:
    footage = TelegramFootage(url=_TG_URL, posted_at="2026-03-04T09:00:00+00:00", media=[])
    resolved = resolve_thread([_telegram_record(footage)])
    assert resolved is not None
    assert resolved.source_url == _TG_URL
    assert resolved.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    assert resolved.source_media == []
    assert _roles(resolved.proof_media) == [["image", "op"]]


def test_unchased_telegram_link_is_link_only() -> None:
    """The no-chase path (record carries no footage) is unchanged: link source,
    no date, no source media, the ``telegram_link`` contract."""
    resolved = resolve_thread([_telegram_record(None)])
    assert resolved is not None
    assert resolved.source_url == _TG_URL
    assert resolved.source_posted_at is None
    assert resolved.source_media == []


def test_ambiguous_footage_links_ignore_chased_telegram() -> None:
    """Two footage links and no designation make the source ambiguous; even a
    chased Telegram footage is dropped and the source stays empty for review."""
    footage = TelegramFootage(url=_TG_URL, posted_at="2026-03-04T09:00:00+00:00", media=[])
    record = _telegram_record(
        footage,
        extra_links=[SourceLink("https://www.youtube.com/watch?v=FAKEVIDEO01", "youtube")],
        designated=False,
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.source_url is None
    assert resolved.source_posted_at is None
    assert resolved.source_media == []
    # No primary was picked, so both candidates land as mirrors and the owner
    # promotes one at submit rather than losing them.
    assert resolved.secondary_source_urls == [
        _TG_URL,
        "https://www.youtube.com/watch?v=FAKEVIDEO01",
    ]


def test_designation_settles_what_would_be_an_ambiguity() -> None:
    """The same two footage links, with the Telegram post written on a
    ``Source:`` line: the explicit designation takes the slot (chased date
    included) and the other candidate lands as a mirror."""
    footage = TelegramFootage(url=_TG_URL, posted_at="2026-03-04T09:00:00+00:00", media=[])
    record = _telegram_record(
        footage,
        extra_links=[SourceLink("https://www.youtube.com/watch?v=FAKEVIDEO01", "youtube")],
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.source_url == _TG_URL
    assert resolved.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    assert resolved.secondary_source_urls == ["https://www.youtube.com/watch?v=FAKEVIDEO01"]


def test_second_footage_link_becomes_a_secondary_source() -> None:
    """A quoted footage tweet takes the source slot; the mirror the OP also
    linked lands as a secondary source instead of being discarded."""
    record = TweetRecord(
        tweet_id="8400000000000000009",
        handle="osint_stork",
        text=f"Geolocated 44.612300, 33.522100 airfield perimeter\nMirror: {_TG_URL}",
        created_at="2026-03-04T13:20:00+00:00",
        permalink="https://x.com/osint_stork/status/8400000000000000009",
        external_sources=[SourceLink(_TG_URL, "telegram")],
        quoted=QuotedTweet(
            tweet_id="8400000000000000002",
            handle="front_cam",
            text="raw footage",
            created_at="2026-03-04T09:00:00+00:00",
        ),
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.source_url == "https://x.com/front_cam/status/8400000000000000002"
    assert resolved.secondary_source_urls == [_TG_URL]


def _links_record(links: list[SourceLink]) -> TweetRecord:
    """A geoloc tweet carrying ``links`` and nothing else that could source it."""
    return TweetRecord(
        tweet_id="8400000000000000010",
        handle="osint_stork",
        text="Geolocated 44.612300, 33.522100 airfield perimeter",
        created_at="2026-03-04T13:20:00+00:00",
        permalink="https://x.com/osint_stork/status/8400000000000000010",
        external_sources=links,
    )


def test_primary_link_is_not_repeated_as_a_secondary() -> None:
    """The source link written in another spelling (``twitter.com``, a tracking
    query) is the primary, not a mirror of it."""
    status = "https://x.com/source_gull/status/8500000000000000002"
    resolved = resolve_thread(
        [
            _links_record(
                [
                    SourceLink(f"{status}?s=20", "x"),
                    SourceLink("https://twitter.com/source_gull/status/8500000000000000002", "x"),
                    SourceLink(status, "x"),
                ]
            )
        ]
    )
    assert resolved is not None
    assert resolved.source_url == f"{status}?s=20"
    assert resolved.secondary_source_urls == []


def test_tracking_query_spelling_of_the_primary_is_not_a_mirror() -> None:
    """The identity strip is what drops it: same video id, share provenance only
    in the query, so the second spelling is the primary and not a mirror."""
    video = "https://www.youtube.com/watch?v=FAKEVIDEO01"
    resolved = resolve_thread(
        [
            _links_record(
                [
                    SourceLink(video, "youtube"),
                    SourceLink(f"{video}&si=abc123&utm_source=x", "youtube"),
                ]
            )
        ]
    )
    assert resolved is not None
    assert resolved.source_url == video
    assert resolved.secondary_source_urls == []


def test_distinct_videos_sharing_a_path_are_separate_mirrors() -> None:
    """Two YouTube ids on the one ``/watch`` path are two videos: the source slot
    collapses them onto one path and takes the first, the second is a mirror
    rather than silently gone."""
    primary = "https://www.youtube.com/watch?v=FAKEVIDEO01"
    mirror = "https://www.youtube.com/watch?v=FAKEVIDEO02"
    resolved = resolve_thread(
        [_links_record([SourceLink(primary, "youtube"), SourceLink(mirror, "youtube")])]
    )
    assert resolved is not None
    assert resolved.source_url == primary
    assert resolved.secondary_source_urls == [mirror]


def test_every_typology_has_both_fixture_files() -> None:
    """Guard the catalogue: each typology ships a body and an expected file so a
    half-added typology fails loudly here, not as a confusing KeyError later."""
    for typology in loader.typology_names():
        assert (loader.FIXTURES_DIR / typology / "body.json").is_file()
        assert (loader.FIXTURES_DIR / typology / "expected.json").is_file()


_ENTRY_PATHS = ("bot", "paste")


def test_every_path_override_names_its_divergence() -> None:
    """Guard the record: a ``paths.<entry>`` block exists because that entry
    answers something the shared resolution does not, so it must say what and
    why. A block that only pins the entry's own vocabulary (a failure reason it
    agrees on) or skips an unreachable shape is exempt."""
    for typology in loader.typology_names():
        paths = loader.load_expected(typology).get("paths", {})
        assert set(paths) <= set(_ENTRY_PATHS), typology
        for entry, block in paths.items():
            overrides = set(block) - {"reason", "diverges", "skip"}
            if not overrides or "skip" in block:
                continue
            assert block.get("diverges"), f"{typology}: {entry} override with no diverges note"
