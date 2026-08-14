"""Integration tests for the machine-detection assemble step.

Exercises ``assemble_detections`` against the DB + local storage: a DTO
becomes a ``detected`` row owned by the backfiller, media lands as ``Media``
with a sha256, and a detection matching a row the owner already holds resolves
through the disposition matrix (skip / upsert / create).
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.config import settings
from app.database import SessionLocal
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.media import Media
from app.models.user import User
from app.services.auth import hash_password
from app.services.detection import assemble_detections, backfill_from_archive
from app.services.source_archive import stage_source_snapshot
from app.services.storage import get_storage
from app.services.tweet_ingest import DetectedGeoloc, ParsedCoord, ParsedMedia
from tests._fixtures import TINY_JPEG

ARCHIVE = Path(__file__).parent / "data" / "synthetic_archive"


def _blue_jpeg() -> bytes:
    """A second, distinct image: "the archive now holds different bytes for this
    media", which is what forces the upsert down its replacement branch. Real
    pixels, because the strip pass re-encodes and would erase a doctored copy of
    ``TINY_JPEG`` back into the same bytes."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color="blue").save(buf, format="JPEG", quality=95)
    return buf.getvalue()


OTHER_JPEG = _blue_jpeg()


def _stored_objects(event_id: uuid.UUID) -> set[str]:
    """Every object the local storage backend holds under one event's prefix.

    Scoped to the event, not to the whole backend: the storage root is shared
    by every test in the run, so a bucket-wide snapshot would move under a
    parallel worker's uploads.
    """
    prefix = Path(settings.local_storage_dir) / "detected" / str(event_id)
    return {str(p.relative_to(prefix)) for p in prefix.rglob("*") if p.is_file()}


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
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
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
    proof_media: list[ParsedMedia] | None = None,
    source_url: str | None = None,
    source_posted_at: datetime | None = None,
    secondary_source_urls: list[str] | None = None,
    title: str = "Strike at Bakhmut",
    proof_text: str = "Strike at Bakhmut\nGeolocated by analyst",
) -> DetectedGeoloc:
    """A detection DTO. Source-less by default, matching the resolve contract:
    a tweet that neither quotes nor links footage declares no source. Sourced
    tests pass ``source_url`` / ``source_posted_at`` explicitly."""
    return DetectedGeoloc(
        coordinate=ParsedCoord(lat=lat, lng=lng),
        title=title,
        proof_text=proof_text,
        source_url=source_url,
        detected_from_url=url,
        owner_handle="own",
        event_date=date(2025, 11, 12),
        source_posted_at=source_posted_at,
        detected_post_at=datetime(2025, 11, 12, 14, 33, tzinfo=UTC),
        secondary_source_urls=secondary_source_urls or [],
        source_media=media or [],
        proof_media=proof_media or [],
    )


def _img() -> ParsedMedia:
    return ParsedMedia(
        kind="image", remote_url="https://pbs.twimg.com/media/x.jpg", content_type="image/jpeg"
    )


async def test_assemble_injects_proof_images_into_proof_doc(db, owner):
    # Proof media persist as role=proof rows AND land as image nodes in the proof
    # JSON; that is how the read surfaces proof images (source travels in ``media``).
    from app.models.media import Media as MediaRow

    dto = _dto(proof_media=[_img(), _img()])
    outcome = await assemble_detections(
        db, owner=owner, detections=[dto], fetch_media=_image_fetcher
    )
    geo = outcome.created[0]
    image_nodes = [n for n in geo.proof["content"] if n.get("type") == "image"]
    assert len(image_nodes) == 2
    assert all(str(n["attrs"]["src"]).startswith("http") for n in image_nodes)
    proof_rows = db.query(MediaRow).filter(MediaRow.event_id == geo.id, MediaRow.role == "proof")
    assert proof_rows.count() == 2


async def test_proof_video_is_skipped_not_orphaned(db, owner):
    # A proof video is never referenced by the proof doc (only images are
    # injected) and the read serialises only source media, so persisting it would
    # orphan the bytes. It is skipped: no media row, no proof image node.
    video = ParsedMedia(
        kind="video", remote_url="https://video.twimg.com/v.mp4", content_type="video/mp4"
    )
    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto(proof_media=[video])], fetch_media=_image_fetcher
    )
    geo = outcome.created[0]
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0
    assert [n for n in geo.proof["content"] if n.get("type") == "image"] == []


async def test_proof_image_kept_when_mixed_with_video(db, owner):
    # A mix of proof image + proof video: only the image persists and is injected
    # into the proof doc; the video is skipped.
    video = ParsedMedia(
        kind="video", remote_url="https://video.twimg.com/v.mp4", content_type="video/mp4"
    )
    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto(proof_media=[_img(), video])], fetch_media=_image_fetcher
    )
    geo = outcome.created[0]
    proof_rows = db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").all()
    assert len(proof_rows) == 1 and proof_rows[0].media_type == "image"
    assert len([n for n in geo.proof["content"] if n.get("type") == "image"]) == 1


async def test_assemble_persists_detected_row(db, owner):
    # A sourced detection (the quote typology): the declared source URL + date
    # and the quote's media land on the row, the media in the source slot.
    sourced = _dto(
        media=[_img()],
        source_url="https://x.com/src/status/9",
        source_posted_at=datetime(2025, 11, 11, 9, 0, tzinfo=UTC),
    )
    outcome = await assemble_detections(
        db, owner=owner, detections=[sourced], fetch_media=_image_fetcher
    )
    assert len(outcome.created) == 1
    assert outcome.skipped == 0 and outcome.updated == 0

    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert geo.status == STATUS_DETECTED
    assert geo.detected_from_url == "https://x.com/own/status/1"
    assert geo.source_url == "https://x.com/src/status/9"
    assert geo.source_posted_at == datetime(2025, 11, 11, 9, 0, tzinfo=UTC)
    assert geo.event_date == date(2025, 11, 12)
    # proof is the wrapped tweet text, never NULL.
    assert geo.proof and geo.proof["type"] == "doc" and geo.proof["content"]

    media = db.query(Media).filter(Media.event_id == geo.id).all()
    assert len(media) == 1
    assert media[0].role == "source"
    assert media[0].media_type == "image"
    assert media[0].sha256 and len(media[0].sha256) == 64


async def test_assemble_prefills_secondary_source_links(db, owner):
    # The mirrors the resolution found land as ordered child rows, so the owner
    # reviews them at submit instead of re-finding the links by hand.
    sourced = _dto(
        source_url="https://x.com/src/status/9",
        secondary_source_urls=["https://t.me/channel/11", "https://www.youtube.com/watch?v=M1"],
    )
    outcome = await assemble_detections(
        db, owner=owner, detections=[sourced], fetch_media=_image_fetcher
    )
    geo = outcome.created[0]
    assert [(link.position, link.url) for link in geo.source_links] == [
        (0, "https://t.me/channel/11"),
        (1, "https://www.youtube.com/watch?v=M1"),
    ]


async def test_two_fetchable_source_media_caps_at_one_role_source_row(db, owner):
    # A quoted tweet can carry both a photo and a video (both fetchable);
    # uq_media_source_per_event allows at most one role=source row per event, so
    # the source-media loop must stop after the first that fetches + prepares
    # cleanly, not attempt a second insert that would raise IntegrityError.
    async def _both_fetcher(parsed: ParsedMedia) -> tuple[bytes, str]:
        if parsed.content_type.startswith("video/"):
            return b"\x00\x00\x00\x18ftypmp42fake", "video/mp4"
        return TINY_JPEG, "image/jpeg"

    video = ParsedMedia(
        kind="video", remote_url="https://video.twimg.com/v.mp4", content_type="video/mp4"
    )
    sourced = _dto(media=[_img(), video], source_url="https://x.com/src/status/9")
    outcome = await assemble_detections(
        db, owner=owner, detections=[sourced], fetch_media=_both_fetcher
    )
    assert len(outcome.created) == 1 and outcome.failed == 0

    geo = outcome.created[0]
    source_rows = db.query(Media).filter(Media.event_id == geo.id, Media.role == "source").all()
    assert len(source_rows) == 1
    assert source_rows[0].media_type == "image"  # the first entry (photo) wins


async def test_media_less_detection_persists(db, owner):
    # A detected row may be media-incomplete and source-less; the owner
    # completes it before submitting. Unlike a human submit, no media, no
    # source URL, no source date required, and none is fabricated.
    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert len(outcome.created) == 1
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert geo.source_url is None
    assert geo.source_posted_at is None
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0


async def test_unchanged_pair_is_skipped_not_updated(db, owner):
    await assemble_detections(db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher)
    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and outcome.skipped == 1 and outcome.updated == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1


async def test_soft_deleted_pair_is_skipped(db, owner):
    # An admin took the event down. A re-import must not put it back: the row
    # stays removed and no live twin appears beside it.
    await assemble_detections(db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.deleted_at = datetime.now(UTC)
    db.commit()

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and outcome.skipped == 1 and outcome.updated == 0
    live = db.query(Event).filter(Event.owner_id == owner.id, Event.deleted_at.is_(None)).all()
    assert live == []


async def test_withheld_pair_is_skipped(db, owner):
    # A takedown freezes the row for its owner too, so a re-import neither
    # overwrites it nor creates a second copy beside it.
    await assemble_detections(db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.hidden_at = datetime.now(UTC)
    db.commit()
    geo_id, stored_title = geo.id, geo.title

    outcome = await assemble_detections(
        db,
        owner=owner,
        detections=[_dto(title="Rewritten by the newer parser")],
        fetch_media=_missing_fetcher,
    )
    assert outcome.created == [] and outcome.skipped == 1 and outcome.updated == 0
    db.expire_all()
    rows = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert [r.id for r in rows] == [geo_id]
    assert rows[0].title == stored_title


async def test_closed_detection_is_skipped(db, owner):
    # The owner-reject shape: the row stays visible as ``closed``
    # (before_closed_status='detected'). The rejection is analyst work, so the
    # re-import respects it instead of queueing the same post again.
    await assemble_detections(db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.before_closed_status = STATUS_DETECTED
    geo.status = "closed"
    geo.closed_at = datetime.now(UTC)
    db.commit()

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and outcome.skipped == 1 and outcome.updated == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1
    assert (
        db.query(Event).filter(Event.owner_id == owner.id, Event.status == "detected").all() == []
    )


async def test_same_source_and_coordinate_skips_across_provenance_urls(db, owner):
    # The delete-and-repost duplicate: two different tweets (distinct
    # detected_from_url) declaring the same footage source at the same
    # coordinate are one event — the second detection skips.
    first = _dto(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    second = _dto(url="https://x.com/own/status/2", source_url="https://t.me/chan/1")
    await assemble_detections(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    outcome = await assemble_detections(
        db, owner=owner, detections=[second], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and outcome.skipped == 1
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1


async def test_same_source_different_coordinate_still_creates(db, owner):
    # Same footage can legitimately yield two events at different places (one
    # video, two strikes) — the source_url leg must not collapse them.
    first = _dto(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    second = _dto(
        url="https://x.com/own/status/2", source_url="https://t.me/chan/1", lat=48.6, lng=34.6
    )
    await assemble_detections(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    outcome = await assemble_detections(
        db, owner=owner, detections=[second], fetch_media=_missing_fetcher
    )
    assert len(outcome.created) == 1 and outcome.skipped == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 2


async def test_sourceless_dtos_do_not_dedup_on_null_source(db, owner):
    # Two source-less detections from different posts at the same coordinate
    # stay distinct: NULL source_url declares nothing, so it can't collide.
    first = _dto(url="https://x.com/own/status/1")
    second = _dto(url="https://x.com/own/status/2")
    await assemble_detections(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    outcome = await assemble_detections(
        db, owner=owner, detections=[second], fetch_media=_missing_fetcher
    )
    assert len(outcome.created) == 1 and outcome.skipped == 0


async def test_geolocated_pair_is_skipped(db, owner):
    # A geolocated row already at this (detected_from_url, coordinate)
    # blocks a machine re-detection.
    existing = Event(
        owner_id=owner.id,
        title="Human submit",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/footage",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2025, 11, 12),
        status=STATUS_GEOLOCATED,
        geolocated_at=datetime.now(UTC),
        detected_from_url="https://x.com/own/status/1",
    )
    db.add(existing)
    db.commit()

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher
    )
    assert outcome.skipped == 1 and outcome.created == []


# ── The upsert: an open draft takes the newer parse in place ───────────────


async def test_detected_draft_is_upserted_in_place(db, owner):
    # The production shape in miniature: the first import stored a source-less,
    # mirror-less, media-less draft; today's parser reads the designation. The
    # newer parse lands on the SAME row, and everything the row is (id, owner,
    # created_at, detected_at, status, provenance) survives it.
    await assemble_detections(db, owner=owner, detections=[_dto()], fetch_media=_missing_fetcher)
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before = {
        "id": stored.id,
        "owner_id": stored.owner_id,
        "created_at": stored.created_at,
        "detected_at": stored.detected_at,
        "detected_from_url": stored.detected_from_url,
    }
    assert stored.source_url is None and stored.source_links == []

    richer = _dto(
        title="Depot hit, Shebekino",
        proof_text="Depot hit, Shebekino\nGeolocated by analyst",
        source_url="https://t.me/channel/42",
        source_posted_at=datetime(2025, 11, 11, 9, 0, tzinfo=UTC),
        secondary_source_urls=["https://www.youtube.com/watch?v=M1"],
        media=[_img()],
    )
    outcome = await assemble_detections(
        db, owner=owner, detections=[richer], fetch_media=_image_fetcher
    )
    assert outcome.created == [] and outcome.updated == 1 and outcome.skipped == 0

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    # What the row IS, preserved.
    assert {k: getattr(row, k) for k in before} == before
    assert row.status == STATUS_DETECTED
    # What the import OWNS, overwritten.
    assert row.title == "Depot hit, Shebekino"
    assert row.source_url == "https://t.me/channel/42"
    assert row.source_posted_at == datetime(2025, 11, 11, 9, 0, tzinfo=UTC)
    assert [link.url for link in row.source_links] == ["https://www.youtube.com/watch?v=M1"]
    assert row.proof["content"][0]["content"][0]["text"] == "Depot hit, Shebekino"
    media = db.query(Media).filter(Media.event_id == row.id).all()
    assert [m.role for m in media] == ["source"]


async def test_upsert_replaces_source_media_and_sweeps_the_old_objects(db, owner):
    # Replacing the footage drops the old row AND its objects, but only once the
    # transaction that dropped the row has landed (commit-then-sweep).
    await assemble_detections(
        db, owner=owner, detections=[_dto(media=[_img()])], fetch_media=_image_fetcher
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    old = db.query(Media).filter(Media.event_id == stored.id, Media.role == "source").one()
    old_key = get_storage().key_from_url(old.storage_url)
    assert old_key is not None and get_storage().get_bytes(old_key)

    async def other_image(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return OTHER_JPEG, "image/jpeg"

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto(media=[_img()])], fetch_media=other_image
    )
    assert outcome.updated == 1

    db.expire_all()
    fresh = db.query(Media).filter(Media.event_id == stored.id, Media.role == "source").one()
    assert fresh.sha256 != old.sha256
    with pytest.raises(FileNotFoundError):
        get_storage().get_bytes(old_key)


async def test_upsert_rewrites_proof_media_and_the_nodes_that_carry_it(db, owner):
    # Proof images live in the proof document, so a media replacement has to
    # move both halves or the document points at a swept object.
    await assemble_detections(
        db, owner=owner, detections=[_dto(proof_media=[_img()])], fetch_media=_image_fetcher
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    old_src = stored.proof["content"][-1]["attrs"]["src"]

    async def other_image(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return OTHER_JPEG, "image/jpeg"

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto(proof_media=[_img()])], fetch_media=other_image
    )
    assert outcome.updated == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    new_src = row.proof["content"][-1]["attrs"]["src"]
    assert new_src != old_src
    rows = db.query(Media).filter(Media.event_id == row.id).all()
    assert [m.storage_url for m in rows] == [new_src]


async def test_upsert_matched_through_the_source_url_leg(db, owner):
    # The delete-and-repost duplicate: a second post declaring the same footage
    # at the same coordinate updates the draft the first one created, under the
    # provenance URL the draft was filed with.
    first = _dto(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    await assemble_detections(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    stored_id = db.query(Event).filter(Event.owner_id == owner.id).one().id

    second = _dto(
        url="https://x.com/own/status/2",
        source_url="https://t.me/chan/1",
        title="Corrected wording",
    )
    outcome = await assemble_detections(
        db, owner=owner, detections=[second], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and outcome.updated == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.id == stored_id
    assert row.title == "Corrected wording"
    # The provenance the draft was filed under is not the import's to move.
    assert row.detected_from_url == "https://x.com/own/status/1"


async def test_upsert_drops_a_snapshot_of_a_source_url_the_row_no_longer_declares(db, owner):
    # The one analyst artifact a draft can carry: an archived copy. A copy filed
    # as the source of a URL the event stops declaring must not survive as the
    # archived source of a link that is gone.
    first = _dto(source_url="https://t.me/chan/1")
    await assemble_detections(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    stage_source_snapshot(
        db,
        event=row,
        snapshot_url="https://web.archive.org/web/20260101120000/https://t.me/chan/1",
    )
    db.commit()
    assert len(row.archives) == 1

    moved = _dto(source_url="https://t.me/chan/2")
    outcome = await assemble_detections(
        db, owner=owner, detections=[moved], fetch_media=_missing_fetcher
    )
    assert outcome.updated == 1

    db.expire_all()
    fresh = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert fresh.source_url == "https://t.me/chan/2"
    assert fresh.archives == []


async def test_reimporting_the_same_detection_twice_writes_nothing(db, owner):
    # Idempotence, the whole promise: no field churn, no proof rewrite, no media
    # re-upload, no new objects in the bucket, and ``updated_at`` does not move.
    dto = _dto(
        source_url="https://t.me/chan/1",
        secondary_source_urls=["https://www.youtube.com/watch?v=M1"],
        media=[_img()],
        proof_media=[_img()],
    )
    await assemble_detections(db, owner=owner, detections=[dto], fetch_media=_image_fetcher)
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before_updated_at = stored.updated_at
    before_media = {(m.id, m.storage_url, m.sha256) for m in stored.media}
    before_objects = _stored_objects(stored.id)

    outcome = await assemble_detections(
        db, owner=owner, detections=[dto], fetch_media=_image_fetcher
    )
    assert outcome.created == [] and outcome.updated == 0 and outcome.skipped == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.updated_at == before_updated_at
    assert {(m.id, m.storage_url, m.sha256) for m in row.media} == before_media
    assert _stored_objects(row.id) == before_objects


async def test_backfill_from_archive_end_to_end(db, owner):
    # Full chain: read the synthetic X export -> stitch -> detect -> assemble.
    outcome = await backfill_from_archive(db, owner=owner, archive_dir=ARCHIVE)
    assert len(outcome.created) == 6  # see test_archive for the per-tweet breakdown

    geos = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert len(geos) == 6
    assert all(g.status == STATUS_DETECTED for g in geos)
    assert all(g.proof and g.proof["content"] for g in geos)
    # No tweet in the synthetic archive quotes or links footage: every row is
    # honestly source-less, nothing deduced from the tweets' own permalinks.
    assert all(g.source_url is None for g in geos)
    assert all(g.source_posted_at is None for g in geos)

    # Only the two photo-bearing tweets (1001 + the 2001/2002 thread head)
    # ingested media, and their own photos are annotation (role=proof), never
    # promoted to source; the coord-only tweets persist media-incomplete.
    media_rows = (
        db.query(Media)
        .join(Event, Media.event_id == Event.id)
        .filter(Event.owner_id == owner.id)
        .all()
    )
    assert len(media_rows) == 2
    assert all(m.role == "proof" for m in media_rows)

    # Re-running the same archive is a no-op (idempotent on the permalink+coord).
    again = await backfill_from_archive(db, owner=owner, archive_dir=ARCHIVE)
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
    assert db.query(Media).filter(Media.event_id.in_(geo_ids)).count() == 2


async def test_unusable_media_is_skipped_and_detection_still_persists(db, owner):
    # An undecodable image must not abort the detection — it persists
    # media-incomplete, not failed.
    async def bad_image_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return b"this is not a real image", "image/jpeg"

    outcome = await assemble_detections(
        db, owner=owner, detections=[_dto(media=[_img()])], fetch_media=bad_image_fetcher
    )
    assert len(outcome.created) == 1 and outcome.failed == 0
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0


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
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1


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
