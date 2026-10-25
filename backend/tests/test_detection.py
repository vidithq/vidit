"""Integration tests for the machine-detection write path (``persist_detections``)."""

from __future__ import annotations

import dataclasses
import io
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.cache import points_cache
from app.config import settings
from app.database import SessionLocal
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    DetectedVia,
    Event,
    EventDetection,
    EventVersion,
)
from app.models.media import Media
from app.models.source import Source, SourceLink
from app.models.user import User
from app.services import versions
from app.services.auth import hash_password
from app.services.detection import (
    Outcome,
    _row_disposition,
    _write_warnings,
    backfill_from_archive,
    persist_detections,
)
from app.services.sanitize import extract_image_srcs, html_text
from app.services.storage import get_storage
from app.services.tweet_ingest import (
    DUPLICATE_MEDIA,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FETCH_FAILED,
    SOURCE_FOOTAGE_MISSING,
    SOURCE_MISSING,
    Detection,
    ParsedCoord,
    ParsedMedia,
    Resolution,
)
from app.services.tweet_ingest.resolve import LinkSource
from tests._fixtures import TINY_JPEG, stored_bytes, stored_path

ARCHIVE = Path(__file__).parent / "data" / "synthetic_archive"


def _blue_jpeg() -> bytes:
    """Different bytes for the same media, to force the upsert replacement branch.

    Real pixels: the strip pass re-encodes and would erase a doctored ``TINY_JPEG``.
    """
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color="blue").save(buf, format="JPEG", quality=95)
    return buf.getvalue()


OTHER_JPEG = _blue_jpeg()


def _stored_objects(event_id: uuid.UUID) -> set[str]:
    """Objects under one event's prefix (the storage root is shared across parallel workers)."""
    prefix = stored_path(f"detected/{event_id}")
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
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


async def _image_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
    return TINY_JPEG, "image/jpeg"


async def _missing_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str] | None:
    return None


async def _persist(
    db, *, owner: User, detections: list[Detection], fetch_media, via: DetectedVia = "archive"
) -> Outcome:
    """Persist ``detections`` as one resolution."""
    return await persist_detections(
        db,
        owner=owner,
        resolution=Resolution(detections=detections),
        via=via,
        fetch_media=fetch_media,
    )


def _row(db, event_id) -> Event:
    """Re-read the row an id in ``Outcome`` names (``Outcome`` carries ids, not rows)."""
    return db.query(Event).filter(Event.id == event_id).one()


def _sources(row: Event) -> list[tuple[str, str, list[tuple[str, datetime | None]], bool]]:
    """Each source as ``(level, kind, [(url, posted_at)], has_file)``, in the derived order."""
    return [
        (
            source.level,
            source.kind,
            [(link.url, link.posted_at) for link in source.links],
            source.media is not None,
        )
        for source in row.sources
    ]


def _source_media(db, event_id: uuid.UUID) -> list[Media]:
    """The files on an event's sources (proof images hang off the event instead)."""
    return (
        db.query(Media)
        .join(Source, Media.source_id == Source.id)
        .filter(Source.event_id == event_id)
        .all()
    )


def _all_media(row: Event) -> set[tuple[str, str, str]]:
    """``(role, storage_url, sha256)`` for the proof images and the source files of ``row``."""
    files = list(row.media) + [s.media for s in row.sources if s.media is not None]
    return {(m.role, m.storage_url, m.sha256) for m in files}


def _detection(
    *,
    lat: float = 48.5,
    lng: float = 34.5,
    url: str = "https://x.com/own/status/1",
    thread_tweet_ids: tuple[int, ...] | None = None,
    media: list[ParsedMedia] | None = None,
    proof_media: list[ParsedMedia] | None = None,
    source_url: str | None = None,
    source_posted_at: datetime | None = None,
    source_fetch_failed: bool = False,
    secondary_source_urls: list[str] | None = None,
    secondary_sources: list[LinkSource] | None = None,
    title: str = "Strike at Bakhmut",
    proof_text: str = "Strike at Bakhmut\nGeolocated by analyst",
) -> Detection:
    """A source-less detection by default; sourced tests pass ``source_url`` explicitly."""
    return Detection(
        coordinate=ParsedCoord(lat=lat, lng=lng),
        title=title,
        proof_text=proof_text,
        source_url=source_url,
        # The engine keys on the post id, so it follows the URL.
        detected_from_post_id=int(url.rsplit("/", 1)[-1]),
        detected_from_url=url,
        # One-post thread by default; a stitched thread passes its ids.
        thread_tweet_ids=(
            thread_tweet_ids if thread_tweet_ids is not None else (int(url.rsplit("/", 1)[-1]),)
        ),
        occurred_date=date(2025, 11, 12),
        source_posted_at=source_posted_at,
        detected_post_at=datetime(2025, 11, 12, 14, 33, tzinfo=UTC),
        secondary_sources=(
            secondary_sources
            if secondary_sources is not None
            else [LinkSource(url=url) for url in secondary_source_urls or []]
        ),
        source_media=media or [],
        proof_media=proof_media or [],
        source_fetch_failed=source_fetch_failed,
    )


def _img() -> ParsedMedia:
    return ParsedMedia(kind="image", remote_url="https://pbs.twimg.com/media/x.jpg")


def _publish_the_default_pair(db, owner: User) -> None:
    """A ``geolocated`` row at the post and coordinate ``_detection()`` defaults to."""
    db.add(
        Event(
            owner_id=owner.id,
            title="Human submit",
            coords=from_shape(Point(34.5, 48.5), srid=4326),
            sources=[
                Source(
                    level="direct",
                    kind="smartphone",
                    links=[
                        SourceLink(
                            url="https://example.com/footage",
                            posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
                        )
                    ],
                )
            ],
            occurred_date=date(2025, 11, 12),
            status=STATUS_GEOLOCATED,
            geolocated_at=datetime.now(UTC),
            detection=EventDetection(from_url="https://x.com/own/status/1", from_post_id=1),
        )
    )
    db.commit()


async def test_assemble_injects_proof_images_into_the_proof(db, owner):
    # Proof media persist as proof rows on the event and as images in the proof HTML.
    detection = _detection(proof_media=[_img(), _img()])
    outcome = await _persist(db, owner=owner, detections=[detection], fetch_media=_image_fetcher)
    geo = _row(db, outcome.created[0])
    srcs = extract_image_srcs(geo.proof)
    assert len(srcs) == 2
    assert all(src.startswith("http") for src in srcs)
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 2
    assert geo.sources == []


async def test_proof_video_is_skipped_not_orphaned(db, owner):
    # A proof video would be persisted but never referenced, orphaning the bytes.
    video = ParsedMedia(kind="video", remote_url="https://video.twimg.com/v.mp4")
    outcome = await _persist(
        db, owner=owner, detections=[_detection(proof_media=[video])], fetch_media=_image_fetcher
    )
    geo = _row(db, outcome.created[0])
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0
    assert extract_image_srcs(geo.proof) == []


async def test_proof_image_kept_when_mixed_with_video(db, owner):
    video = ParsedMedia(kind="video", remote_url="https://video.twimg.com/v.mp4")
    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(proof_media=[_img(), video])],
        fetch_media=_image_fetcher,
    )
    geo = _row(db, outcome.created[0])
    proof_rows = db.query(Media).filter(Media.event_id == geo.id).all()
    assert len(proof_rows) == 1 and proof_rows[0].kind == "image"
    assert len(extract_image_srcs(geo.proof)) == 1


async def test_assemble_persists_detected_row(db, owner):
    sourced = _detection(
        media=[_img()],
        source_url="https://x.com/src/status/9",
        source_posted_at=datetime(2025, 11, 11, 9, 0, tzinfo=UTC),
    )
    outcome = await _persist(db, owner=owner, detections=[sourced], fetch_media=_image_fetcher)
    assert len(outcome.created) == 1
    assert len(outcome.skipped) == 0 and len(outcome.updated) == 0

    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert geo.status == STATUS_DETECTED
    assert geo.detection.from_url == "https://x.com/own/status/1"
    assert geo.occurred_date == date(2025, 11, 12)
    assert geo.proof.startswith("<p>")
    # One direct source: the declared URL with its post time, and the footage. The review
    # names the kind.
    assert _sources(geo) == [
        (
            "direct",
            "unknown",
            [("https://x.com/src/status/9", datetime(2025, 11, 11, 9, 0, tzinfo=UTC))],
            True,
        )
    ]
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0

    media = _source_media(db, geo.id)
    assert len(media) == 1
    assert media[0].kind == "image"
    assert media[0].sha256 and len(media[0].sha256) == 64


async def test_each_mirror_lands_as_its_own_direct_source_after_the_declared_one(db, owner):
    """A mirror carries its URL only: no file, no post time, kind ``unknown``."""
    sourced = _detection(
        source_url="https://x.com/src/status/9",
        secondary_source_urls=["https://t.me/channel/11", "https://www.youtube.com/watch?v=M1"],
    )
    outcome = await _persist(db, owner=owner, detections=[sourced], fetch_media=_image_fetcher)
    geo = _row(db, outcome.created[0])
    assert _sources(geo) == [
        ("direct", "unknown", [("https://x.com/src/status/9", None)], False),
        ("direct", "unknown", [("https://t.me/channel/11", None)], False),
        ("direct", "unknown", [("https://www.youtube.com/watch?v=M1", None)], False),
    ]


_EARTH = LinkSource(
    url="https://earth.google.com/web/@48.5,34.5,50a",
    level="context",
    kind="satellite",
    title="Google Earth",
)


async def test_a_context_link_lands_as_a_context_source_with_its_kind_and_title(db, owner):
    """A dated mirror keeps its post time; a context link keeps its level, kind and title."""
    mirror = LinkSource(url="https://x.com/m/status/9", posted_at=datetime(2024, 5, 1, tzinfo=UTC))
    sourced = _detection(
        source_url="https://x.com/src/status/9", secondary_sources=[mirror, _EARTH]
    )
    outcome = await _persist(db, owner=owner, detections=[sourced], fetch_media=_image_fetcher)
    geo = _row(db, outcome.created[0])
    assert [(s.level, s.kind, s.title) for s in geo.sources] == [
        ("direct", "unknown", ""),
        ("direct", "unknown", ""),
        ("context", "satellite", "Google Earth"),
    ]
    assert [link.posted_at for link in geo.sources[1].links] == [mirror.posted_at]


async def test_a_re_import_rebuilds_a_mirror_the_resolution_now_reads_as_context(db, owner):
    """The re-import shape reads level, kind and title, not only the links."""
    before = _detection(source_url="https://x.com/src/status/9", secondary_source_urls=[_EARTH.url])
    await _persist(db, owner=owner, detections=[before], fetch_media=_image_fetcher)

    after = dataclasses.replace(before, secondary_sources=[_EARTH])
    outcome = await _persist(db, owner=owner, detections=[after], fetch_media=_image_fetcher)

    assert len(outcome.updated) == 1
    geo = _row(db, outcome.updated[0])
    assert [(s.level, s.kind) for s in geo.sources] == [
        ("direct", "unknown"),
        ("context", "satellite"),
    ]


async def test_a_file_on_a_context_source_is_no_footage(db, owner):
    """The footage warning reads direct and indirect sources only, as the publish floor does."""
    sourced = _detection(source_url="https://x.com/src/status/9", media=[_img()])
    outcome = await _persist(db, owner=owner, detections=[sourced], fetch_media=_image_fetcher)
    assert SOURCE_FOOTAGE_MISSING not in outcome.warnings
    geo = _row(db, outcome.created[0])
    geo.sources[0].level = "context"
    db.commit()

    assert _write_warnings(db, [(geo.id, sourced)]) == {
        SOURCE_FOOTAGE_MISSING: 1,
        SOURCE_DATE_UNKNOWN: 1,
    }


async def test_two_fetchable_source_media_store_one_file_on_the_declared_source(db, owner):
    # uq_media_source_id allows one file per source: the loop must stop after the first
    # success instead of raising IntegrityError on a second insert.
    async def _both_fetcher(parsed: ParsedMedia) -> tuple[bytes, str]:
        if parsed.content_type.startswith("video/"):
            return b"\x00\x00\x00\x18ftypmp42fake", "video/mp4"
        return TINY_JPEG, "image/jpeg"

    video = ParsedMedia(kind="video", remote_url="https://video.twimg.com/v.mp4")
    sourced = _detection(media=[_img(), video], source_url="https://x.com/src/status/9")
    outcome = await _persist(db, owner=owner, detections=[sourced], fetch_media=_both_fetcher)
    assert len(outcome.created) == 1 and outcome.failed == 0

    geo = _row(db, outcome.created[0])
    source_rows = _source_media(db, geo.id)
    assert len(source_rows) == 1
    assert source_rows[0].kind == "image"  # the first entry (photo) wins
    assert len(geo.sources) == 1


async def test_media_less_detection_persists(db, owner):
    # Unlike a human submit, no media, source URL or source date is required or fabricated.
    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )
    assert len(outcome.created) == 1
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert geo.sources == []
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0


async def test_unchanged_pair_is_skipped_not_updated(db, owner):
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1


async def test_a_pass_that_wrote_a_row_drops_the_points_cache(db, owner):
    """A ``detected`` row is public on landing, so the map cache must drop."""
    points_cache.set("points:whatever", b"[]")
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    assert points_cache.get("points:whatever") is None


async def test_a_pass_that_wrote_nothing_leaves_the_points_cache_alone(db, owner):
    """The invalidation follows the write, not the pass."""
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    points_cache.set("points:whatever", b"[]")
    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )
    assert len(outcome.skipped) == 1
    assert points_cache.get("points:whatever") == b"[]"


async def test_soft_deleted_pair_is_skipped(db, owner):
    # A re-import must not resurrect an admin takedown or add a live twin.
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.deleted_at = datetime.now(UTC)
    db.commit()

    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    live = db.query(Event).filter(Event.owner_id == owner.id, Event.deleted_at.is_(None)).all()
    assert live == []


async def test_withheld_pair_is_skipped(db, owner):
    # A takedown freezes the row: no overwrite, no second copy.
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.hidden_at = datetime.now(UTC)
    db.commit()
    geo_id, stored_title = geo.id, geo.title

    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(title="Rewritten by the newer parser")],
        fetch_media=_missing_fetcher,
    )
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    db.expire_all()
    rows = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert [r.id for r in rows] == [geo_id]
    assert rows[0].title == stored_title


async def test_closed_detection_is_skipped(db, owner):
    # An owner reject (``closed``, before_closed_status='detected') is respected by re-imports.
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.before_closed_status = STATUS_DETECTED
    geo.status = "closed"
    geo.closed_at = datetime.now(UTC)
    db.commit()

    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1
    assert (
        db.query(Event).filter(Event.owner_id == owner.id, Event.status == "detected").all() == []
    )


async def test_retracted_geolocation_is_skipped(db, owner):
    """Closing a published row does not let a re-import reopen it as a fresh ``detected`` row."""
    _publish_the_default_pair(db, owner)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo_id, stored_title = geo.id, geo.title
    geo.before_closed_status = STATUS_GEOLOCATED
    geo.status = "closed"
    geo.closed_at = datetime.now(UTC)
    geo.close_reason = "Wrong village"
    db.commit()

    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0

    db.expire_all()
    rows = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert [r.id for r in rows] == [geo_id]
    assert rows[0].status == "closed"
    assert rows[0].title == stored_title


async def test_a_detection_stays_at_version_0_while_re_imports_overwrite_it(db, owner):
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(title="Rewritten by the newer parser")],
        fetch_media=_missing_fetcher,
    )
    assert len(outcome.updated) == 1
    db.expire_all()
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert geo.title == "Rewritten by the newer parser"
    assert geo.version_no == 0
    assert db.query(EventVersion).filter(EventVersion.event_id == geo.id).count() == 0


async def test_a_published_detection_is_never_re_imported(db, owner):
    """Once a person saved a version (the publish files version 0), the import leaves it."""
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo_id, stored_title = geo.id, geo.title
    versions.file_version(db, geo=geo, edited_by=owner, note=None)
    geo.status = STATUS_GEOLOCATED
    geo.geolocated_at = datetime.now(UTC)
    db.commit()

    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(title="Rewritten by the newer parser")],
        fetch_media=_missing_fetcher,
    )
    assert outcome.created == [] and outcome.skipped == [geo_id] and outcome.updated == []
    db.expire_all()
    row = db.get(Event, geo_id)
    assert row.title == stored_title
    assert row.version_no == 1


def test_the_import_writes_only_onto_version_0():
    """The rule reads the version, not only the status: a detection a person saved a version
    of is skipped too."""
    assert _row_disposition(Event(status=STATUS_DETECTED, version_no=0)) == "upsert"
    assert _row_disposition(Event(status=STATUS_DETECTED, version_no=1)) == "skip"


async def test_same_source_and_coordinate_skips_across_provenance_urls(db, owner):
    # Delete-and-repost: two tweets declaring the same source at one coordinate are one event.
    first = _detection(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    second = _detection(url="https://x.com/own/status/2", source_url="https://t.me/chan/1")
    await _persist(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, detections=[second], fetch_media=_missing_fetcher)
    assert outcome.created == [] and len(outcome.skipped) == 1
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1


async def test_a_corrected_source_url_still_matches_its_own_re_import(db, owner):
    """A hand-submitted row is matched by source URL, so the match must also read the versions.

    After the owner corrects the URL only the filed version still holds the original.
    """
    original = "https://t.me/chan/original"
    geo = Event(
        owner_id=owner.id,
        title="Human submit",
        coords=from_shape(Point(34.5, 48.5), srid=4326),
        sources=[
            Source(
                level="direct",
                kind="smartphone",
                links=[SourceLink(url="https://t.me/chan/corrected")],
            )
        ],
        occurred_date=date(2025, 11, 12),
        status=STATUS_GEOLOCATED,
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.commit()
    db.add(
        EventVersion(
            event_id=geo.id,
            version_no=1,
            edited_by_id=owner.id,
            snapshot={
                "sources": [
                    {
                        "level": "direct",
                        "kind": "smartphone",
                        "links": [
                            {
                                "url": original,
                                "posted_at": None,
                                "snapshot_url": None,
                                "archived_at": None,
                            }
                        ],
                        "media": None,
                    }
                ]
            },
        )
    )
    geo.version_no = 2
    db.commit()
    geo_id = geo.id

    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(url="https://x.com/own/status/77", source_url=original)],
        fetch_media=_missing_fetcher,
    )
    assert outcome.created == [] and len(outcome.skipped) == 1

    db.expire_all()
    assert [row.id for row in db.query(Event).filter(Event.owner_id == owner.id)] == [geo_id]


async def test_same_source_different_coordinate_still_creates(db, owner):
    # One video can show two strikes: the source URL leg must not collapse them.
    first = _detection(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    second = _detection(
        url="https://x.com/own/status/2", source_url="https://t.me/chan/1", lat=48.6, lng=34.6
    )
    await _persist(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, detections=[second], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1 and len(outcome.skipped) == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 2


async def test_sourceless_dtos_do_not_dedup_on_null_source(db, owner):
    # A detection with no source URL declares nothing, so it cannot collide.
    first = _detection(url="https://x.com/own/status/1")
    second = _detection(url="https://x.com/own/status/2")
    await _persist(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, detections=[second], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1 and len(outcome.skipped) == 0


async def test_two_spellings_of_one_post_land_on_one_detection(db, owner):
    # The match anchor is the post id, not the URL (``twitter.com`` vs ``x.com``).
    await _persist(
        db,
        owner=owner,
        detections=[_detection(url="https://x.com/own/status/7", title="First read")],
        fetch_media=_missing_fetcher,
    )
    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(url="https://twitter.com/Own/status/7", title="Second read")],
        fetch_media=_missing_fetcher,
    )
    assert len(outcome.updated) == 1 and outcome.created == []
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "Second read"
    # Provenance is not the import's to move.
    assert row.detection.from_url == "https://x.com/own/status/7"


async def test_an_archive_thread_then_a_bot_tag_on_its_tail_is_one_detection(db, owner):
    """Self-thread A, B, C with the coordinate in C: the export anchors on A, a bot tag on C on B.

    The match reads the threads' post ids, so one row results whichever entry ran first.
    """
    archive = _detection(
        url="https://x.com/own/status/101",
        thread_tweet_ids=(101, 102, 103),
        title="From the export",
    )
    await _persist(
        db, owner=owner, detections=[archive], fetch_media=_missing_fetcher, via="archive"
    )

    tagged = _detection(
        url="https://x.com/own/status/102",
        thread_tweet_ids=(102, 103),
        title="From the tag",
    )
    outcome = await _persist(
        db, owner=owner, detections=[tagged], fetch_media=_missing_fetcher, via="bot"
    )

    assert len(outcome.updated) == 1 and outcome.created == []
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "From the tag"
    # Provenance and entry stay those of the first read.
    assert row.detection.from_url == "https://x.com/own/status/101"
    assert row.detection.thread_post_ids == [101, 102, 103]
    assert row.detection.via == "archive"


async def test_a_bot_tag_then_the_archive_of_the_same_thread_is_one_detection(db, owner):
    """The reverse order of the archive-then-tag case."""
    tagged = _detection(
        url="https://x.com/own/status/102",
        thread_tweet_ids=(102, 103),
        title="From the tag",
    )
    await _persist(db, owner=owner, detections=[tagged], fetch_media=_missing_fetcher, via="bot")

    archive = _detection(
        url="https://x.com/own/status/101",
        thread_tweet_ids=(101, 102, 103),
        title="From the export",
    )
    outcome = await _persist(
        db, owner=owner, detections=[archive], fetch_media=_missing_fetcher, via="archive"
    )

    assert len(outcome.updated) == 1 and outcome.created == []
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "From the export"
    assert row.detection.from_url == "https://x.com/own/status/102"
    assert row.detection.via == "bot"


async def test_two_threads_sharing_no_post_are_two_detections(db, owner):
    """Only an overlap matches: unrelated threads at one coordinate stay two rows."""
    first = _detection(url="https://x.com/own/status/201", thread_tweet_ids=(201, 202))
    second = _detection(url="https://x.com/own/status/301", thread_tweet_ids=(301, 302))
    await _persist(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, detections=[second], fetch_media=_missing_fetcher)

    assert len(outcome.created) == 1 and outcome.updated == []
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 2


@pytest.mark.parametrize(("via", "tweet_id"), [("bot", 401), ("paste", 402), ("archive", 403)])
async def test_the_entry_that_produced_a_detection_is_stamped_on_the_row(db, owner, via, tweet_id):
    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(url=f"https://x.com/own/status/{tweet_id}")],
        fetch_media=_missing_fetcher,
        via=via,
    )
    [row_id] = outcome.created
    assert _row(db, row_id).detection.via == via


async def test_geolocated_pair_is_skipped(db, owner):
    _publish_the_default_pair(db, owner)

    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )
    assert len(outcome.skipped) == 1 and outcome.created == []


async def test_detected_detection_is_upserted_in_place(db, owner):
    # A newer parse lands on the same row; its identity fields survive.
    await _persist(db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher)
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before = {
        "id": stored.id,
        "owner_id": stored.owner_id,
        "created_at": stored.created_at,
        "detected_at": stored.detected_at,
    }
    provenance = stored.detection.from_url
    assert stored.sources == []

    richer = _detection(
        title="Depot hit, Shebekino",
        proof_text="Depot hit, Shebekino\nGeolocated by analyst",
        source_url="https://t.me/channel/42",
        source_posted_at=datetime(2025, 11, 11, 9, 0, tzinfo=UTC),
        secondary_source_urls=["https://www.youtube.com/watch?v=M1"],
        media=[_img()],
    )
    outcome = await _persist(db, owner=owner, detections=[richer], fetch_media=_image_fetcher)
    assert outcome.created == [] and len(outcome.updated) == 1 and len(outcome.skipped) == 0

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert {k: getattr(row, k) for k in before} == before
    assert row.detection.from_url == provenance
    assert row.status == STATUS_DETECTED
    # Import-owned fields are overwritten.
    assert row.title == "Depot hit, Shebekino"
    assert _sources(row) == [
        (
            "direct",
            "unknown",
            [("https://t.me/channel/42", datetime(2025, 11, 11, 9, 0, tzinfo=UTC))],
            True,
        ),
        ("direct", "unknown", [("https://www.youtube.com/watch?v=M1", None)], False),
    ]
    assert html_text(row.proof).split("\n")[0] == "Depot hit, Shebekino"
    assert db.query(Media).filter(Media.event_id == row.id).count() == 0


async def test_a_re_import_whose_fetch_comes_back_short_keeps_the_stored_media(db, owner):
    """A failed fetch (CDN outage) must not read as the post losing its media."""
    await _persist(
        db,
        owner=owner,
        detections=[_detection(media=[_img()], proof_media=[_img()])],
        fetch_media=_image_fetcher,
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before = _all_media(stored)
    keys = {get_storage().key_from_url(url) for _role, url, _sha in before}
    assert len(before) == 2

    outcome = await _persist(
        db,
        owner=owner,
        # A newer title gives the write path something to update.
        detections=[_detection(media=[_img()], proof_media=[_img()], title="Corrected wording")],
        fetch_media=_missing_fetcher,
    )
    assert len(outcome.updated) == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "Corrected wording"
    assert _all_media(row) == before
    for key in keys:
        assert key is not None and stored_bytes(key)
    assert extract_image_srcs(row.proof) == [
        url for role, url, _sha in sorted(before) if role == "proof"
    ]


async def test_a_re_import_that_only_loses_its_media_moves_nothing(db, owner):
    """With nothing else to write, the row is untouched and counted skipped."""
    await _persist(
        db, owner=owner, detections=[_detection(media=[_img()])], fetch_media=_image_fetcher
    )
    db.expire_all()
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    updated_at = stored.updated_at

    outcome = await _persist(
        db, owner=owner, detections=[_detection(media=[_img()])], fetch_media=_missing_fetcher
    )
    assert outcome.updated == [] and outcome.skipped == [stored.id]

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.updated_at == updated_at
    assert [source.media is not None for source in row.sources] == [True]
    assert row.media == []


async def test_a_pass_that_wrote_nothing_reports_no_warnings(db, owner):
    """A detection matching a published row is left alone, so nothing warns."""
    _publish_the_default_pair(db, owner)

    outcome = await _persist(
        db, owner=owner, detections=[_detection()], fetch_media=_missing_fetcher
    )

    assert len(outcome.skipped) == 1 and outcome.created == [] and outcome.updated == []
    assert outcome.warnings == {}


async def test_the_warnings_count_the_rows_the_pass_wrote(db, owner):
    """Two detections, one already published: only the one that landed is counted."""
    _publish_the_default_pair(db, owner)

    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(), _detection(lat=50.0, lng=30.0, url="https://x.com/own/status/2")],
        fetch_media=_missing_fetcher,
    )

    assert len(outcome.created) == 1 and len(outcome.skipped) == 1
    assert outcome.warnings == {SOURCE_FOOTAGE_MISSING: 1, SOURCE_DATE_UNKNOWN: 1}


async def test_upsert_replaces_source_media_and_sweeps_the_old_objects(db, owner):
    # Objects are swept only after the transaction dropping the row has landed.
    await _persist(
        db, owner=owner, detections=[_detection(media=[_img()])], fetch_media=_image_fetcher
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    [old] = _source_media(db, stored.id)
    old_key = get_storage().key_from_url(old.storage_url)
    assert old_key is not None and stored_bytes(old_key)

    async def other_image(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return OTHER_JPEG, "image/jpeg"

    outcome = await _persist(
        db, owner=owner, detections=[_detection(media=[_img()])], fetch_media=other_image
    )
    assert len(outcome.updated) == 1

    db.expire_all()
    [fresh] = _source_media(db, stored.id)
    assert fresh.sha256 != old.sha256
    with pytest.raises(FileNotFoundError):
        stored_bytes(old_key)


async def test_upsert_rewrites_proof_media_and_the_body_that_carries_it(db, owner):
    # The proof body and the media rows must move together, or the body points at a swept object.
    await _persist(
        db, owner=owner, detections=[_detection(proof_media=[_img()])], fetch_media=_image_fetcher
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    old_src = extract_image_srcs(stored.proof)[-1]

    async def other_image(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return OTHER_JPEG, "image/jpeg"

    outcome = await _persist(
        db, owner=owner, detections=[_detection(proof_media=[_img()])], fetch_media=other_image
    )
    assert len(outcome.updated) == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    new_src = extract_image_srcs(row.proof)[-1]
    assert new_src != old_src
    rows = db.query(Media).filter(Media.event_id == row.id).all()
    assert [m.storage_url for m in rows] == [new_src]


async def test_upsert_matched_through_the_source_url_leg(db, owner):
    # Delete-and-repost: the second post updates the first one's detection.
    first = _detection(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    await _persist(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    stored_id = db.query(Event).filter(Event.owner_id == owner.id).one().id

    second = _detection(
        url="https://x.com/own/status/2",
        source_url="https://t.me/chan/1",
        title="Corrected wording",
    )
    outcome = await _persist(db, owner=owner, detections=[second], fetch_media=_missing_fetcher)
    assert outcome.created == [] and len(outcome.updated) == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.id == stored_id
    assert row.title == "Corrected wording"
    assert row.detection.from_url == "https://x.com/own/status/1"


async def test_upsert_drops_a_snapshot_of_a_source_url_the_row_no_longer_declares(db, owner):
    # An archived copy must not outlive the source URL it was filed for.
    first = _detection(source_url="https://t.me/chan/1")
    await _persist(db, owner=owner, detections=[first], fetch_media=_missing_fetcher)
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    [link] = row.sources[0].links
    link.snapshot_url = "https://web.archive.org/web/20260101120000/https://t.me/chan/1"
    link.archived_at = datetime.now(UTC)
    db.commit()

    moved = _detection(source_url="https://t.me/chan/2")
    outcome = await _persist(db, owner=owner, detections=[moved], fetch_media=_missing_fetcher)
    assert len(outcome.updated) == 1

    db.expire_all()
    fresh = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert _sources(fresh) == [("direct", "unknown", [("https://t.me/chan/2", None)], False)]
    assert fresh.sources[0].links[0].snapshot_url is None
    assert db.query(SourceLink).filter(SourceLink.url == "https://t.me/chan/1").count() == 0


async def test_upsert_whose_source_links_moved_keeps_the_unchanged_file(db, owner):
    """The sources are rebuilt around the stored object: no re-upload, no sweep."""
    await _persist(
        db,
        owner=owner,
        detections=[_detection(source_url="https://t.me/chan/1", media=[_img()])],
        fetch_media=_image_fetcher,
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    [old] = _source_media(db, stored.id)
    old_url, old_sha = old.storage_url, old.sha256
    before_objects = _stored_objects(stored.id)

    moved = _detection(
        source_url="https://t.me/chan/2",
        secondary_source_urls=["https://www.youtube.com/watch?v=M1"],
        media=[_img()],
    )
    outcome = await _persist(db, owner=owner, detections=[moved], fetch_media=_image_fetcher)
    assert len(outcome.updated) == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert _sources(row) == [
        ("direct", "unknown", [("https://t.me/chan/2", None)], True),
        ("direct", "unknown", [("https://www.youtube.com/watch?v=M1", None)], False),
    ]
    assert [(m.storage_url, m.sha256) for m in _source_media(db, row.id)] == [(old_url, old_sha)]
    assert _stored_objects(row.id) == before_objects


async def test_reimporting_the_same_detection_twice_writes_nothing(db, owner):
    # Idempotence: no field churn, re-upload, new objects, or ``updated_at`` move.
    detection = _detection(
        source_url="https://t.me/chan/1",
        secondary_sources=[
            LinkSource(url="https://x.com/m/status/9", posted_at=datetime(2024, 5, 1, tzinfo=UTC)),
            _EARTH,
        ],
        media=[_img()],
        proof_media=[_img()],
    )
    await _persist(db, owner=owner, detections=[detection], fetch_media=_image_fetcher)
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before_updated_at = stored.updated_at
    before_sources = [source.id for source in stored.sources]
    before_media = _all_media(stored)
    before_objects = _stored_objects(stored.id)

    outcome = await _persist(db, owner=owner, detections=[detection], fetch_media=_image_fetcher)
    assert outcome.created == [] and len(outcome.updated) == 0 and len(outcome.skipped) == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.updated_at == before_updated_at
    assert [source.id for source in row.sources] == before_sources
    assert _all_media(row) == before_media
    assert _stored_objects(row.id) == before_objects


async def test_a_backfill_refuses_an_owner_with_no_linked_handle(db, owner):
    """Never fall back onto the username (it may be someone else's on X).

    Backstop behind the worker's gate in ``archive_jobs.process``.
    """
    owner.x_handle = None
    db.commit()

    with pytest.raises(ValueError):
        await backfill_from_archive(db, owner=owner, archive_dir=ARCHIVE)
    assert db.query(Event).filter(Event.owner_id == owner.id).all() == []


async def test_thread_media_fetched_and_prepared_once_across_coordinates(db, owner):
    # Two coordinates from one post: two rows, one fetch of the shared image.
    calls = {"n": 0}

    async def counting_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        calls["n"] += 1
        return TINY_JPEG, "image/jpeg"

    img = _img()
    detections = [
        _detection(lat=48.5, lng=34.5, url="https://x.com/own/status/9", media=[img]),
        _detection(lat=50.0, lng=30.0, url="https://x.com/own/status/9", media=[img]),
    ]
    outcome = await _persist(db, owner=owner, detections=detections, fetch_media=counting_fetcher)
    assert len(outcome.created) == 2
    assert calls["n"] == 1  # fetched once, shared across both coordinate rows
    assert [len(_source_media(db, geo_id)) for geo_id in outcome.created] == [1, 1]


async def test_unusable_media_is_skipped_and_detection_still_persists(db, owner):
    # An undecodable image leaves the detection media-incomplete, not failed.
    async def bad_image_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return b"this is not a real image", "image/jpeg"

    outcome = await _persist(
        db, owner=owner, detections=[_detection(media=[_img()])], fetch_media=bad_image_fetcher
    )
    assert len(outcome.created) == 1 and outcome.failed == 0
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert geo.sources == []
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0


async def test_over_cap_media_is_skipped_and_detection_still_persists(db, owner, monkeypatch):
    # Over ``max_image_size`` raises the same ``ValueError`` as an undecodable image.
    # Only the dropped source photo warns (``source_footage_missing``).
    monkeypatch.setattr(settings, "max_image_size", len(TINY_JPEG) - 1)

    async def over_cap_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return TINY_JPEG, "image/jpeg"

    detection = _detection(
        source_url="https://t.me/chan/42",
        source_posted_at=datetime(2025, 11, 11, 8, 0, tzinfo=UTC),
        media=[_img()],
        # A distinct URL: the fetch cache keys on it.
        proof_media=[ParsedMedia(kind="image", remote_url="https://pbs.twimg.com/media/y.jpg")],
    )
    outcome = await _persist(db, owner=owner, detections=[detection], fetch_media=over_cap_fetcher)

    assert len(outcome.created) == 1 and outcome.failed == 0
    assert outcome.warnings == {SOURCE_FOOTAGE_MISSING: 1}
    row = _row(db, outcome.created[0])
    assert _sources(row) == [
        (
            "direct",
            "unknown",
            [("https://t.me/chan/42", datetime(2025, 11, 11, 8, 0, tzinfo=UTC))],
            False,
        )
    ]
    assert db.query(Media).filter(Media.event_id == row.id).count() == 0
    assert not extract_image_srcs(row.proof)


async def test_failed_detection_is_isolated_not_lost(db, owner, monkeypatch):
    # A mid-persist failure is rolled back and counted; the others still land.
    async def boom(*_a, **_k):
        raise RuntimeError("upload exploded")

    monkeypatch.setattr("app.services.detection.upload_prepared_media", boom)

    bad = _detection(lat=48.5, lng=34.5, url="https://x.com/own/status/11", media=[_img()])
    good = _detection(lat=50.0, lng=30.0, url="https://x.com/own/status/12")  # no media
    outcome = await _persist(db, owner=owner, detections=[bad, good], fetch_media=_image_fetcher)
    assert outcome.failed == 1
    assert len(outcome.created) == 1
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


async def test_a_sourced_detection_that_stored_no_footage_warns(db, owner):
    """A declared source that stored no file and has an unknown post date warns."""
    detection = _detection(
        source_url="https://t.me/chan/42",
        media=[_img()],
        source_posted_at=None,
    )
    outcome = await _persist(db, owner=owner, detections=[detection], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {SOURCE_FOOTAGE_MISSING: 1, SOURCE_DATE_UNKNOWN: 1}


async def test_a_source_the_chase_could_not_reach_warns_that_it_may_come_back(db, owner):
    """An upstream failure differs from a source with no footage: a re-run may fill it."""
    detection = _detection(
        source_url="https://t.me/chan/42",
        media=[_img()],
        source_posted_at=None,
        source_fetch_failed=True,
    )
    outcome = await _persist(db, owner=owner, detections=[detection], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {SOURCE_FETCH_FAILED: 1, SOURCE_DATE_UNKNOWN: 1}


async def test_a_detection_with_footage_and_a_source_date_warns_about_neither(db, owner):
    detection = _detection(
        source_url="https://t.me/chan/42",
        media=[_img()],
        source_posted_at=datetime(2025, 11, 11, 8, 0, tzinfo=UTC),
    )
    outcome = await _persist(db, owner=owner, detections=[detection], fetch_media=_image_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {}


async def test_an_empty_source_slot_suppresses_the_footage_and_date_warnings(db, owner):
    """A source-less detection already says why there is no footage or date."""
    detection = _detection(media=[_img()])
    detection = dataclasses.replace(detection, warnings=[SOURCE_MISSING])
    outcome = await _persist(db, owner=owner, detections=[detection], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {SOURCE_MISSING: 1}


async def test_media_already_on_another_event_warns_once_per_row(db, owner):
    """Exact sha256 match against events outside the pass; the pass's own rows do not flag each other."""
    first = await _persist(
        db, owner=owner, detections=[_detection(proof_media=[_img()])], fetch_media=_image_fetcher
    )
    assert len(first.created) == 1
    assert DUPLICATE_MEDIA not in first.warnings

    second = await _persist(
        db,
        owner=owner,
        detections=[
            _detection(url="https://x.com/own/status/2", lat=49.5, proof_media=[_img()]),
            _detection(url="https://x.com/own/status/3", lat=50.5, proof_media=[_img()]),
        ],
        fetch_media=_image_fetcher,
    )
    assert len(second.created) == 2
    assert second.warnings[DUPLICATE_MEDIA] == 2


async def test_a_source_file_already_on_another_event_warns(db, owner):
    """The duplicate check reads source files as well as proof images."""
    await _persist(
        db, owner=owner, detections=[_detection(media=[_img()])], fetch_media=_image_fetcher
    )

    outcome = await _persist(
        db,
        owner=owner,
        detections=[_detection(url="https://x.com/own/status/2", lat=49.5, media=[_img()])],
        fetch_media=_image_fetcher,
    )
    assert len(outcome.created) == 1
    assert outcome.warnings[DUPLICATE_MEDIA] == 1
