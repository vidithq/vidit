"""Archive integration contract: the disk-only typologies through the backfill.

Assembles the disk-only typology fixtures into one consolidated X export, runs
the real ``read_tweets`` to ``stitch`` to ``detect`` to ``assemble`` chain over
it against the test database, and asserts per typology: the ``detected`` status,
``source_url`` NULL exactly where the contract says so, the media roles in the
``media`` table, and the proof images injected into the proof JSON.

Strictly offline: every media byte is written to disk from ``TINY_JPEG`` /
``TINY_MP4``, and the one chased-source case stubs ``acquire.fetch_syndication``
plus supplies synthetic bytes for the CDN media, so no request leaves the box.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

import pytest

from app.database import SessionLocal
from app.models.event import STATUS_DETECTED, Event
from app.models.media import Media
from app.models.user import User
from app.services.auth import hash_password
from app.services.detection import assemble_detections, backfill_from_archive
from app.services.tweet_ingest import (
    DetectedGeoloc,
    ParsedCoord,
    ParsedMedia,
    archive_media_fetcher,
    detect,
    read_tweets,
    stitch,
)
from tests._fixtures import TINY_JPEG

from . import loader

# The typologies whose media live on disk and whose source (if any) is a link,
# not a chased tweet: the whole consolidated-archive backfill runs on these with
# ``chase`` off. Quote typologies (an archive quote needs an in-archive join or a
# syndication chase) and the chase branch are covered separately below.
_DISK_TYPOLOGIES = [
    "referenceless_annotation",
    "self_video_no_signal",
    "self_thread",
    "no_coord",
    "multi_coord",
    "mention_prefix",
    "telegram_link",
    "youtube_link",
    "x_status_link",
]


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def owner(db):
    user = User(
        username=f"own{uuid.uuid4().hex[:8]}",
        email=f"own-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        x_handle=f"own{uuid.uuid4().hex[:8]}",
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    # media rows cascade off the event FK (ondelete=CASCADE).
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _head_url(owner: User, typology: str) -> str:
    """The ``detected_from_url`` a typology's row(s) carry under ``owner``.

    The backfill derives the permalink from the owner's handle, not the fixture
    handle, so the lookup URL uses the owner handle + the fixture's head id.
    """
    body = loader.load_body(typology)
    if loader.is_self_thread(body):
        head_id = loader.load_expected(typology)["head_tweet_id"]
    else:
        head_id = body["id_str"]
    handle = owner.x_handle or owner.username
    return f"https://x.com/{handle}/status/{head_id}"


def _rows_for(db, owner: User, typology: str) -> list[Event]:
    url = _head_url(owner, typology)
    return db.query(Event).filter(Event.owner_id == owner.id, Event.detected_from_url == url).all()


def _proof_image_count(event: Event) -> int:
    return sum(1 for node in event.proof["content"] if node.get("type") == "image")


async def test_consolidated_backfill_matches_contract(db, owner, tmp_path):
    archive = tmp_path / "consolidated"
    loader.build_consolidated_archive(_DISK_TYPOLOGIES, archive)

    outcome = await backfill_from_archive(db, owner=owner, archive_dir=archive)

    # One row per coordinate-bearing typology, two for multi_coord, none for
    # no_coord: 7 single + 2 (multi) + 0 = 9.
    assert len(outcome.created) == 9
    assert len(outcome.skipped) == 0 and outcome.failed == 0

    rows = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert len(rows) == 9
    assert all(r.status == STATUS_DETECTED for r in rows)
    assert all(r.proof and r.proof["content"] for r in rows)

    assert _rows_for(db, owner, "no_coord") == []

    # Source-less typologies: source_url NULL, source_posted_at NULL.
    for typology in [
        "referenceless_annotation",
        "self_video_no_signal",
        "self_thread",
        "multi_coord",
        "mention_prefix",
    ]:
        for row in _rows_for(db, owner, typology):
            assert row.source_url is None, typology
            assert row.source_posted_at is None, typology

    # self_thread: provenance is the head permalink (the coordinate lived in the
    # reply, but the head is the thread anchor), and the provisional event_date
    # is the head's post date.
    [thread_row] = _rows_for(db, owner, "self_thread")
    assert thread_row.detected_from_url == _head_url(owner, "self_thread")
    assert thread_row.event_date == _fixture_event_date("self_thread")

    # mention_prefix: the title is the line as the analyst wrote it, leading
    # @mentions and coordinate included.
    [mention_row] = _rows_for(db, owner, "mention_prefix")
    assert mention_row.title == loader.load_expected("mention_prefix")["title"]

    # Link typologies: source_url = the declared link, no source media row, and
    # (link footage is off-platform / not chased here) no source media at all.
    link_expected = {
        "telegram_link": "https://t.me/somechannel/12345",
        "youtube_link": "https://www.youtube.com/watch?v=FAKEVIDEO01",
        "x_status_link": "https://x.com/source_gull/status/8500000000000000002",
    }
    for typology, url in link_expected.items():
        [row] = _rows_for(db, owner, typology)
        assert row.source_url == url, typology
        source_rows = db.query(Media).filter(Media.event_id == row.id, Media.role == "source")
        assert source_rows.count() == 0, typology

    # Media roles + proof-image injection, per typology.
    # referenceless: 2 proof images, both injected into the proof doc.
    [ref] = _rows_for(db, owner, "referenceless_annotation")
    assert _media_roles(db, ref) == {"proof": 2}
    assert _proof_image_count(ref) == 2

    # self_video: the tweet's only media is a video and nothing else declared a
    # source, so it fills the source slot. The proof doc stays image-only, hence
    # empty, and the video survives as evidence instead of being dropped.
    [sv] = _rows_for(db, owner, "self_video_no_signal")
    assert _media_roles(db, sv) == {"source": 1}
    assert _proof_image_count(sv) == 0

    # self_thread: head video + reply photo. The video takes the empty source
    # slot; the photo stays proof and is injected into the proof doc.
    [st] = _rows_for(db, owner, "self_thread")
    assert _media_roles(db, st) == {"source": 1, "proof": 1}
    assert _media_types(db, st) == {"video", "image"}
    assert _proof_image_count(st) == 1

    # mention_prefix: 1 proof image.
    [mp] = _rows_for(db, owner, "mention_prefix")
    assert _media_roles(db, mp) == {"proof": 1}
    assert _proof_image_count(mp) == 1

    # telegram_link: 2 proof images (the annotation photos).
    [tg] = _rows_for(db, owner, "telegram_link")
    assert _media_roles(db, tg) == {"proof": 2}
    assert _proof_image_count(tg) == 2

    # youtube_link + x_status_link (no chase): 1 proof image each.
    for typology in ["youtube_link", "x_status_link"]:
        [row] = _rows_for(db, owner, typology)
        assert _media_roles(db, row) == {"proof": 1}, typology
        assert _proof_image_count(row) == 1, typology

    # multi_coord: two rows sharing detected_from_url, each with the shared proof
    # image; both source-less.
    multi = _rows_for(db, owner, "multi_coord")
    assert len(multi) == 2
    for row in multi:
        assert _media_roles(db, row) == {"proof": 1}
        assert _proof_image_count(row) == 1

    # Re-running the same archive is a no-op (idempotent on permalink + coord).
    again = await backfill_from_archive(db, owner=owner, archive_dir=archive)
    assert again.created == [] and len(again.skipped) == 9


async def test_x_status_link_chase_persists_source_media(db, owner, tmp_path, monkeypatch):
    """The chase branch end to end: an X status link (no inline quote) is chased,
    and the chased tweet's video lands as the source media row while the OP photo
    stays proof. Offline: ``acquire.fetch_syndication`` is stubbed and the CDN
    media bytes are supplied by a synthetic fetcher."""
    import app.services.tweet_ingest.acquire as acquire_mod
    import app.services.tweet_ingest.archive as archive_mod

    typology = "x_status_link"
    body = loader.load_body(typology)
    expected = loader.load_expected(typology)
    chased_body = loader.load_chased(typology, expected["chased_status_id"])

    archive = tmp_path / "chase_archive"
    (archive / "tweets_media").mkdir(parents=True)
    entry, files = loader.archive_tweet_from_body(body)
    loader.write_archive_js(archive, [entry])
    for media_file in files:
        (archive / media_file.relative_path).write_bytes(media_file.data)

    def fake_fetch(tweet_id: str, *, client: Any = None) -> dict[str, Any]:
        return chased_body

    async def fake_cdn(parsed: ParsedMedia) -> tuple[bytes, str] | None:
        # Stand in for the X CDN GET the chased source media would trigger, so
        # the disk fetcher's real path (photos from tweets_media/) still runs but
        # nothing leaves the box.
        return loader.TINY_MP4, parsed.content_type

    monkeypatch.setattr(acquire_mod, "fetch_syndication", fake_fetch)
    monkeypatch.setattr(archive_mod, "fetch_cdn_media", fake_cdn)

    records = read_tweets(archive, handle=owner.x_handle or owner.username, chase=True)
    detections = [d for thread in stitch(records) for d in detect(thread)]
    assert len(detections) == 1

    outcome = await assemble_detections(
        db,
        owner=owner,
        detections=detections,
        fetch_media=archive_media_fetcher(archive),
    )
    assert len(outcome.created) == 1

    [row] = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert row.source_url == expected["source_url"]
    source_media = db.query(Media).filter(Media.event_id == row.id, Media.role == "source").all()
    assert len(source_media) == 1
    assert source_media[0].media_type == "video"
    proof_media = db.query(Media).filter(Media.event_id == row.id, Media.role == "proof").all()
    assert len(proof_media) == 1
    assert proof_media[0].media_type == "image"


async def _run_telegram_chase(db, owner: User, tmp_path, monkeypatch, *, embed: Any) -> Event:
    """Backfill the ``telegram_link`` fixture as a one-tweet archive with the
    Telegram chase stubbed to ``embed``, and return the single created row.

    Offline: ``archive.fetch_telegram_embed`` is replaced with a constant, and
    any source-media CDN GET is served synthetic bytes, so nothing leaves the
    box.
    """
    import app.services.tweet_ingest.archive as archive_mod

    body = loader.load_body("telegram_link")
    archive = tmp_path / "tg_archive"
    (archive / "tweets_media").mkdir(parents=True)
    entry, files = loader.archive_tweet_from_body(body)
    loader.write_archive_js(archive, [entry])
    for media_file in files:
        (archive / media_file.relative_path).write_bytes(media_file.data)

    def fake_embed(url: str, *, client: Any = None) -> Any:
        assert url == "https://t.me/somechannel/12345"
        return embed

    async def fake_cdn(parsed: ParsedMedia) -> tuple[bytes, str]:
        return loader.TINY_MP4, parsed.content_type

    monkeypatch.setattr(archive_mod, "fetch_telegram_embed", fake_embed)
    monkeypatch.setattr(archive_mod, "fetch_cdn_media", fake_cdn)

    records = read_tweets(archive, handle=owner.x_handle or owner.username, chase=True)
    detections = [d for thread in stitch(records) for d in detect(thread)]
    assert len(detections) == 1

    outcome = await assemble_detections(
        db,
        owner=owner,
        detections=detections,
        fetch_media=archive_media_fetcher(archive),
    )
    assert len(outcome.created) == 1 and outcome.failed == 0
    [row] = db.query(Event).filter(Event.owner_id == owner.id).all()
    return row


async def test_telegram_chase_fills_date_and_source_media(db, owner, tmp_path, monkeypatch):
    """A t.me footage link, chased: the embed's date fills ``source_posted_at``
    and its video lands as the source media, while the OP photos stay proof."""
    from app.services.tweet_ingest.telegram import TelegramEmbed

    embed = TelegramEmbed(
        posted_at="2026-03-04T09:00:00+00:00",
        media=[
            ParsedMedia(
                kind="video",
                remote_url="https://cdn4.cdn-telegram.org/file/v.mp4",
                content_type="video/mp4",
                origin="quote",
            )
        ],
    )
    row = await _run_telegram_chase(db, owner, tmp_path, monkeypatch, embed=embed)

    assert row.source_url == "https://t.me/somechannel/12345"
    assert row.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    source = db.query(Media).filter(Media.event_id == row.id, Media.role == "source").all()
    assert len(source) == 1 and source[0].media_type == "video"
    proof = db.query(Media).filter(Media.event_id == row.id, Media.role == "proof").all()
    assert len(proof) == 2 and all(m.media_type == "image" for m in proof)


async def test_telegram_chase_sensitive_degrades_to_date_only(db, owner, tmp_path, monkeypatch):
    """A sensitive t.me post: the embed serves the date but no media. The date
    fills, no source media is stored, and the backfill does not fail."""
    from app.services.tweet_ingest.telegram import TelegramEmbed

    embed = TelegramEmbed(posted_at="2026-03-04T09:00:00+00:00", media=[])
    row = await _run_telegram_chase(db, owner, tmp_path, monkeypatch, embed=embed)

    assert row.source_url == "https://t.me/somechannel/12345"
    assert row.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    source = db.query(Media).filter(Media.event_id == row.id, Media.role == "source").all()
    assert len(source) == 0
    proof = db.query(Media).filter(Media.event_id == row.id, Media.role == "proof").all()
    assert len(proof) == 2 and all(m.media_type == "image" for m in proof)


async def test_reimport_fills_a_draft_an_earlier_run_left_bare(db, owner, tmp_path, monkeypatch):
    """A re-import completes a draft in place instead of leaving it bare.

    A first pass with the chase off stored the post with no ``source_url``, no
    source date and no source media. Running the same export with the chase on
    fills all three on the same row rather than creating a second one beside it.
    """
    import app.services.tweet_ingest.archive as archive_mod
    from app.services.tweet_ingest.telegram import TelegramEmbed

    handle = owner.x_handle or owner.username
    tweet_id = "8400000000000000042"
    permalink = f"https://x.com/{handle}/status/{tweet_id}"
    archive = _telegram_source_archive(tmp_path, tweet_id)

    def fake_embed(url: str, *, client: Any = None) -> Any:
        assert url == "https://t.me/somechannel/12345"
        return TelegramEmbed(
            posted_at="2026-03-04T09:00:00+00:00",
            media=[
                ParsedMedia(
                    kind="video",
                    remote_url="https://cdn4.cdn-telegram.org/file/v.mp4",
                    content_type="video/mp4",
                    origin="quote",
                )
            ],
        )

    async def fake_cdn(parsed: ParsedMedia) -> tuple[bytes, str]:
        return loader.TINY_MP4, parsed.content_type

    monkeypatch.setattr(archive_mod, "fetch_telegram_embed", fake_embed)
    monkeypatch.setattr(archive_mod, "fetch_cdn_media", fake_cdn)

    # The row the old import left behind: the right post at the right place,
    # and nothing the whole-line designation would have given it.
    stale = await assemble_detections(
        db,
        owner=owner,
        detections=[_bare_detection(permalink)],
        fetch_media=archive_media_fetcher(archive),
    )
    assert len(stale.created) == 1
    stale_row = stale.created[0]
    stale_id, stale_created_at = stale_row.id, stale_row.created_at
    assert stale_row.source_url is None
    assert stale_row.source_links == []
    assert db.query(Media).filter(Media.event_id == stale_id, Media.role == "source").all() == []

    # The same export with the chase on: the Telegram embed answers with the
    # date and the footage.
    outcome = await backfill_from_archive(db, owner=owner, archive_dir=archive, chase=True)
    assert outcome.created == [] and len(outcome.updated) == 1 and outcome.failed == 0

    db.expire_all()
    [row] = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert row.id == stale_id  # the same row, not a second one beside it
    assert row.created_at == stale_created_at
    assert row.status == STATUS_DETECTED
    assert row.detected_from_url == permalink
    assert row.source_url == "https://t.me/somechannel/12345"
    assert row.source_posted_at == datetime.fromisoformat("2026-03-04T09:00:00+00:00")
    assert row.source_links == []
    source = db.query(Media).filter(Media.event_id == row.id, Media.role == "source").all()
    assert len(source) == 1 and source[0].media_type == "video"


def _bare_detection(permalink: str) -> DetectedGeoloc:
    """What a chase-less pass produced for this post: the coordinate, the text
    and the annotation photo, and nothing else, so the draft carried no source
    URL, no mirrors and no footage."""
    return DetectedGeoloc(
        coordinate=ParsedCoord(lat=44.6123, lng=33.5221),
        title="Geolocated airfield perimeter",
        proof_text="Geolocated airfield perimeter",
        source_url=None,
        detected_from_url=permalink,
        owner_handle="own",
        event_date=date(2026, 3, 4),
        source_posted_at=None,
        detected_post_at=datetime.fromisoformat("2026-03-04T13:20:00+00:00"),
        secondary_source_urls=[],
        source_media=[],
        proof_media=[
            ParsedMedia(
                kind="image",
                remote_url=f"tweets_media/{permalink.rsplit('/', 1)[-1]}-FAKEOP9A.jpg",
                content_type="image/jpeg",
            )
        ],
    )


def _telegram_source_archive(tmp_path: Any, tweet_id: str) -> Any:
    """A one-tweet export: a coordinate, one Telegram link, one annotation photo."""
    archive = tmp_path / "reimport_archive"
    (archive / "tweets_media").mkdir(parents=True)
    entry = {
        "id_str": tweet_id,
        "created_at": "Wed Mar 04 13:20:00 +0000 2026",
        "full_text": (
            "Geolocated 44.612300, 33.522100 airfield perimeter\nSource: https://t.co/fakeTELE"
        ),
        "entities": {
            "urls": [
                {"url": "https://t.co/fakeTELE", "expanded_url": "https://t.me/somechannel/12345"},
            ],
            "media": [
                {
                    "id_str": "9100000000000000001",
                    "media_url_https": "https://pbs.twimg.com/media/FAKEOP9A.jpg",
                    "type": "photo",
                }
            ],
        },
    }
    loader.write_archive_js(archive, [entry])
    (archive / "tweets_media" / f"{tweet_id}-FAKEOP9A.jpg").write_bytes(TINY_JPEG)
    return archive


# ── Small DB-shape helpers ─────────────────────────────────────────────────


def _media_roles(db, event: Event) -> dict[str, int]:
    counts: dict[str, int] = {}
    for media in db.query(Media).filter(Media.event_id == event.id).all():
        counts[media.role] = counts.get(media.role, 0) + 1
    return counts


def _media_types(db, event: Event) -> set[str]:
    return {m.media_type for m in db.query(Media).filter(Media.event_id == event.id).all()}


def _fixture_event_date(typology: str) -> date:
    return date.fromisoformat(loader.load_expected(typology)["event_date"])
