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

from app.services.tweet_ingest import detect, stitch
from app.services.tweet_ingest.records import SourceLink, TelegramFootage, TweetRecord
from app.services.tweet_ingest.resolve import ResolvedTweet, resolve_thread
from app.services.tweet_ingest.syndication import ParsedMedia

from . import loader

_COORD_PLACES = 6


def _resolved_for(typology: str, tmp_path: Path) -> ResolvedTweet:
    body = loader.load_body(typology)
    if loader.is_self_thread(body):
        threads = stitch(loader.thread_from_self_thread(typology, tmp_path))
        assert len(threads) == 1, f"{typology}: expected one stitched thread"
        resolved = resolve_thread(threads[0])
    else:
        resolved = resolve_thread([loader.record_from_body(body)])
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
    body = loader.load_body(typology)
    expected = loader.load_expected(typology)
    if loader.is_self_thread(body):
        thread = stitch(loader.thread_from_self_thread(typology, tmp_path))[0]
    else:
        thread = [loader.record_from_body(body)]

    dtos = detect(thread)
    assert len(dtos) == len(expected["coords"])
    for dto in dtos:
        assert dto.source_url == expected["source_url"]
        assert _roles(dto.source_media) == [list(pair) for pair in expected["source_media"]]
        assert _roles(dto.proof_media) == [list(pair) for pair in expected["proof_media"]]
        assert dto.title == expected["title"]


def test_x_status_link_chase_fills_source_from_chased_tweet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The archive chase branch: an X status link with no inline quote resolves
    its source from the chased tweet (its canonical url, date, and media), while
    the OP's own photo stays proof. Exercises the ``from``-imported
    ``archive.fetch_syndication`` seam the plan flags."""
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

    monkeypatch.setattr(archive_mod, "fetch_syndication", fake_fetch)
    records = archive_mod.read_tweets(archive, handle=body["user"]["screen_name"], chase=True)

    resolved = resolve_thread(records)
    assert resolved is not None
    assert resolved.source_url == chase["source_url"]
    assert resolved.source_posted_at == datetime.fromisoformat(chase["source_posted_at"])
    assert _roles(resolved.source_media) == [list(pair) for pair in chase["source_media"]]
    assert _roles(resolved.proof_media) == [list(pair) for pair in chase["proof_media"]]


_TG_URL = "https://t.me/somechannel/12345"


def _telegram_record(
    telegram: TelegramFootage | None, *, extra_links: list[SourceLink] | None = None
) -> TweetRecord:
    """A geoloc tweet linking a t.me post, with an optional chased footage.

    One OP photo (annotation) and a Telegram footage link. ``telegram`` is the
    chased embed (or ``None`` for the no-chase path); ``extra_links`` adds more
    footage links to exercise the ambiguity rule.
    """
    return TweetRecord(
        tweet_id="8400000000000000001",
        handle="osint_stork",
        text=f"Geolocated 44.612300, 33.522100 airfield perimeter\nSource: {_TG_URL}",
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
    no date, no source media — the ``telegram_link`` contract."""
    resolved = resolve_thread([_telegram_record(None)])
    assert resolved is not None
    assert resolved.source_url == _TG_URL
    assert resolved.source_posted_at is None
    assert resolved.source_media == []


def test_ambiguous_footage_links_ignore_chased_telegram() -> None:
    """A second footage link makes the source ambiguous; even a chased Telegram
    footage is dropped and the source stays empty for review."""
    footage = TelegramFootage(url=_TG_URL, posted_at="2026-03-04T09:00:00+00:00", media=[])
    record = _telegram_record(
        footage,
        extra_links=[SourceLink("https://www.youtube.com/watch?v=FAKEVIDEO01", "youtube")],
    )
    resolved = resolve_thread([record])
    assert resolved is not None
    assert resolved.source_url is None
    assert resolved.source_posted_at is None
    assert resolved.source_media == []


def test_every_typology_has_both_fixture_files() -> None:
    """Guard the catalogue: each typology ships a body and an expected file so a
    half-added typology fails loudly here, not as a confusing KeyError later."""
    for typology in loader.typology_names():
        assert (loader.FIXTURES_DIR / typology / "body.json").is_file()
        assert (loader.FIXTURES_DIR / typology / "expected.json").is_file()
