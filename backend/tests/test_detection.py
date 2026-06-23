"""Integration tests for the machine-detection assemble step.

Exercises ``assemble_detections`` against the DB + local storage: a DTO
becomes a ``detected`` row owned by the backfiller, media lands as ``Media``
with a sha256, and the ``(detected_from_url, coordinate)`` idempotency
skips / recreates correctly.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.models.geolocation import STATE_DETECTED, STATE_VALIDATED, Geolocation
from app.models.media import Media
from app.models.user import User
from app.services.auth import hash_password
from app.services.detection import assemble_detections, backfill_from_archive
from app.services.tweet_ingest import DetectedGeoloc, ParsedCoord, ParsedMedia
from tests._fixtures import TINY_JPEG

ARCHIVE = Path(__file__).parent / "data" / "synthetic_archive"


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
    # media rows cascade off the geolocation FK (ondelete=CASCADE).
    db.query(Geolocation).filter(Geolocation.author_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


async def _image_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
    return TINY_JPEG, "image/jpeg"


async def _missing_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str] | None:
    return None


def _dto(
    *,
    lat: float = 48.5,
    lng: float = 34.5,
    url: str = "https://x.com/own/status/1",
    media: list[ParsedMedia] | None = None,
) -> DetectedGeoloc:
    return DetectedGeoloc(
        coordinate=ParsedCoord(lat=lat, lng=lng),
        title="Strike at Bakhmut",
        proof_text="Strike at Bakhmut\nGeolocated by analyst",
        detected_from_url=url,
        owner_handle="own",
        event_date=date(2025, 11, 12),
        media=media or [],
    )


def _img() -> ParsedMedia:
    return ParsedMedia(
        kind="image", remote_url="https://pbs.twimg.com/media/x.jpg", content_type="image/jpeg"
    )


async def test_assemble_persists_detected_row(db, owner):
    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto(media=[_img()])], fetch_media=_image_fetcher
    )
    assert len(outcome.created) == 1
    assert outcome.skipped == 0 and outcome.recreated == 0

    geo = db.query(Geolocation).filter(Geolocation.author_id == owner.id).one()
    assert geo.state == STATE_DETECTED
    assert geo.detected_from_url == "https://x.com/own/status/1"
    assert geo.source_url == "https://x.com/own/status/1"
    assert geo.event_date == date(2025, 11, 12)
    # proof is the wrapped tweet text, never NULL.
    assert geo.proof and geo.proof["type"] == "doc" and geo.proof["content"]

    media = db.query(Media).filter(Media.geolocation_id == geo.id).all()
    assert len(media) == 1
    assert media[0].media_type == "image"
    assert media[0].sha256 and len(media[0].sha256) == 64


async def test_media_less_detection_persists(db, owner):
    # A detected row may be media-incomplete — the owner completes it before
    # validating. No media required, unlike a human submit.
    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert len(outcome.created) == 1
    geo = db.query(Geolocation).filter(Geolocation.author_id == owner.id).one()
    assert db.query(Media).filter(Media.geolocation_id == geo.id).count() == 0


async def test_idempotency_skips_existing_pair(db, owner):
    await assemble_detections(db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher)
    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and outcome.skipped == 1
    assert db.query(Geolocation).filter(Geolocation.author_id == owner.id).count() == 1


async def test_idempotency_recreates_soft_deleted_pair(db, owner):
    await assemble_detections(db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher)
    geo = db.query(Geolocation).filter(Geolocation.author_id == owner.id).one()
    geo.deleted_at = datetime.now(UTC)
    db.commit()

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert len(outcome.created) == 1 and outcome.recreated == 1
    live = (
        db.query(Geolocation)
        .filter(Geolocation.author_id == owner.id, Geolocation.deleted_at.is_(None))
        .all()
    )
    assert len(live) == 1


async def test_validated_pair_is_skipped(db, owner):
    # A human (validated) row already at this (detected_from_url, coordinate)
    # blocks a machine re-detection.
    existing = Geolocation(
        author_id=owner.id,
        title="Human submit",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/footage",
        event_date=date(2025, 11, 12),
        state=STATE_VALIDATED,
        detected_from_url="https://x.com/own/status/1",
    )
    db.add(existing)
    db.commit()

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert outcome.skipped == 1 and outcome.created == []


async def test_backfill_from_archive_end_to_end(db, owner):
    # Full chain: read the synthetic X export -> stitch -> detect -> assemble.
    outcome = await backfill_from_archive(db, owner=owner, archive_dir=ARCHIVE, is_demo=True)
    assert len(outcome.created) == 6  # see test_archive for the per-tweet breakdown

    geos = db.query(Geolocation).filter(Geolocation.author_id == owner.id).all()
    assert len(geos) == 6
    assert all(g.state == STATE_DETECTED for g in geos)
    assert all(g.is_demo for g in geos)  # dev/admin seed marks them wipeable
    assert all(g.proof and g.proof["content"] for g in geos)

    # Only the two photo-bearing tweets (1001 + the 2001/2002 thread head)
    # ingested media; the coord-only tweets persist media-incomplete.
    media_count = (
        db.query(Media)
        .join(Geolocation, Media.geolocation_id == Geolocation.id)
        .filter(Geolocation.author_id == owner.id)
        .count()
    )
    assert media_count == 2

    # Re-running the same archive is a no-op (idempotent on the permalink+coord).
    again = await backfill_from_archive(db, owner=owner, archive_dir=ARCHIVE, is_demo=True)
    assert again.created == [] and again.skipped == 6


async def test_thread_media_fetched_and_prepared_once_across_coordinates(db, owner):
    # Two coordinates from the same post (same detected_from_url + media) → two
    # rows, but the shared image is fetched / stripped only once (cache).
    calls = {"n": 0}

    async def counting_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        calls["n"] += 1
        return TINY_JPEG, "image/jpeg"

    img = _img()
    detections = [
        _dto(lat=48.5, lng=34.5, url="https://x.com/own/status/9", media=[img]),
        _dto(lat=50.0, lng=30.0, url="https://x.com/own/status/9", media=[img]),
    ]
    outcome = await assemble_detections(
        db, owner=owner, detections=detections, fetch_media=counting_fetcher
    )
    assert len(outcome.created) == 2
    assert calls["n"] == 1  # fetched once, shared across both coordinate rows
    geo_ids = [g.id for g in outcome.created]
    assert db.query(Media).filter(Media.geolocation_id.in_(geo_ids)).count() == 2


async def test_unusable_media_is_skipped_and_detection_still_persists(db, owner):
    # An undecodable image must not abort the detection — it persists
    # media-incomplete, not failed.
    async def bad_image_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return b"this is not a real image", "image/jpeg"

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto(media=[_img()])], fetch_media=bad_image_fetcher
    )
    assert len(outcome.created) == 1 and outcome.failed == 0
    geo = db.query(Geolocation).filter(Geolocation.author_id == owner.id).one()
    assert db.query(Media).filter(Media.geolocation_id == geo.id).count() == 0


async def test_failed_detection_is_isolated_not_lost(db, owner, monkeypatch):
    # One detection raising mid-persist is caught, counted, rolled back — the
    # others still land, and no partial row survives.
    async def boom(*_a, **_k):
        raise RuntimeError("upload exploded")

    monkeypatch.setattr("app.services.detection.upload_prepared_media", boom)

    bad = _dto(lat=48.5, lng=34.5, url="https://x.com/own/status/A", media=[_img()])
    good = _dto(lat=50.0, lng=30.0, url="https://x.com/own/status/B")  # no media
    outcome = await assemble_detections(
        db, owner=owner, detections=[bad, good], fetch_media=_image_fetcher
    )
    assert outcome.failed == 1
    assert len(outcome.created) == 1
    # The failed detection's partial row was rolled back, not orphaned.
    assert db.query(Geolocation).filter(Geolocation.author_id == owner.id).count() == 1


def test_validate_bytes_guards_type_and_size():
    from app.config import settings
    from app.services.storage import validate_bytes

    assert validate_bytes(b"x", "image/jpeg") == "image"
    assert validate_bytes(b"x", "video/mp4") == "video"
    with pytest.raises(ValueError):
        validate_bytes(b"x", "application/pdf")  # disallowed type
    with pytest.raises(ValueError):
        validate_bytes(b"x" * (settings.max_image_size + 1), "image/jpeg")  # oversize


def test_preview_detection_returns_dtos_without_db():
    from app.services.detection import preview_detection

    body = {
        "user": {"screen_name": "ana"},
        "text": "Strike at 48.012345, 37.802411",
        "created_at": "2025-11-12T14:33:00.000Z",
    }
    mock = httpx.Client(transport=httpx.MockTransport(lambda _req: httpx.Response(200, json=body)))
    out = preview_detection("https://x.com/ana/status/987654321", client=mock)
    assert len(out) == 1
    assert out[0].coordinate.lat == pytest.approx(48.012345)
    assert out[0].detected_from_url == "https://x.com/ana/status/987654321"
    assert out[0].owner_handle == "ana"
