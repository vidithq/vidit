"""Integration tests for the machine-detection write path.

Exercises ``persist_drafts`` against the DB + local storage: a ``Draft``
becomes a ``detected`` row owned by the importer, media lands as ``Media``
with a sha256, and a draft matching a row the owner already holds resolves
through the disposition matrix (skip / upsert / create).
"""

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
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, DetectedVia, Event
from app.models.media import Media
from app.models.user import User
from app.services.auth import hash_password
from app.services.detection import Outcome, backfill_from_archive, persist_drafts
from app.services.source_archive import stage_source_snapshot
from app.services.storage import get_storage
from app.services.tweet_ingest import (
    DUPLICATE_MEDIA,
    SOURCE_DATE_UNKNOWN,
    SOURCE_FETCH_FAILED,
    SOURCE_FOOTAGE_MISSING,
    SOURCE_MISSING,
    Draft,
    ParsedCoord,
    ParsedMedia,
    Resolution,
)
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


async def _persist(
    db, *, owner: User, drafts: list[Draft], fetch_media, via: DetectedVia = "archive"
) -> Outcome:
    """Persist ``drafts`` as one resolution, which is what an entry hands over."""
    return await persist_drafts(
        db,
        owner=owner,
        resolution=Resolution(drafts=drafts),
        via=via,
        fetch_media=fetch_media,
    )


def _row(db, event_id) -> Event:
    """The stored row behind an id the outcome named.

    ``Outcome`` carries ids rather than mapped rows (see ``services/detection``),
    so a test reading a column re-reads the row it wrote.
    """
    return db.query(Event).filter(Event.id == event_id).one()


def _draft(
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
    title: str = "Strike at Bakhmut",
    proof_text: str = "Strike at Bakhmut\nGeolocated by analyst",
) -> Draft:
    """A draft. Source-less by default, matching the resolve contract: a tweet
    that neither quotes nor links footage declares no source. Sourced tests pass
    ``source_url`` / ``source_posted_at`` explicitly."""
    return Draft(
        coordinate=ParsedCoord(lat=lat, lng=lng),
        title=title,
        proof_text=proof_text,
        source_url=source_url,
        # The post id the engine keys on, read back off the URL the caller named
        # so a test varying one varies both, as the engine does.
        detected_from_tweet_id=int(url.rsplit("/", 1)[-1]),
        detected_from_url=url,
        # A one-post thread by default: the anchor is the whole thread, which
        # is what the two live entries read off a post with no same-author
        # parent. A stitched thread passes its ids.
        thread_tweet_ids=(
            thread_tweet_ids if thread_tweet_ids is not None else (int(url.rsplit("/", 1)[-1]),)
        ),
        event_date=date(2025, 11, 12),
        source_posted_at=source_posted_at,
        detected_post_at=datetime(2025, 11, 12, 14, 33, tzinfo=UTC),
        secondary_source_urls=secondary_source_urls or [],
        source_media=media or [],
        proof_media=proof_media or [],
        source_fetch_failed=source_fetch_failed,
    )


def _img() -> ParsedMedia:
    return ParsedMedia(kind="image", remote_url="https://pbs.twimg.com/media/x.jpg")


def _publish_the_default_pair(db, owner: User) -> None:
    """A ``geolocated`` row at the post and coordinate ``_draft()`` defaults to.

    The human submit a machine re-detection has to leave alone, which is what
    the skip, the untouched row and the empty warning count are all read
    against.
    """
    db.add(
        Event(
            owner_id=owner.id,
            title="Human submit",
            event_coords=from_shape(Point(34.5, 48.5), srid=4326),
            source_url="https://example.com/footage",
            source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
            event_date=date(2025, 11, 12),
            status=STATUS_GEOLOCATED,
            geolocated_at=datetime.now(UTC),
            detected_from_tweet_id=1,
            detected_from_url="https://x.com/own/status/1",
        )
    )
    db.commit()


async def test_assemble_injects_proof_images_into_proof_doc(db, owner):
    # Proof media persist as role=proof rows AND land as image nodes in the proof
    # JSON; that is how the read surfaces proof images (source travels in ``media``).
    from app.models.media import Media as MediaRow

    draft = _draft(proof_media=[_img(), _img()])
    outcome = await _persist(db, owner=owner, drafts=[draft], fetch_media=_image_fetcher)
    geo = _row(db, outcome.created[0])
    image_nodes = [n for n in geo.proof["content"] if n.get("type") == "image"]
    assert len(image_nodes) == 2
    assert all(str(n["attrs"]["src"]).startswith("http") for n in image_nodes)
    proof_rows = db.query(MediaRow).filter(MediaRow.event_id == geo.id, MediaRow.role == "proof")
    assert proof_rows.count() == 2


async def test_proof_video_is_skipped_not_orphaned(db, owner):
    # A proof video is never referenced by the proof doc (only images are
    # injected) and the read serialises only source media, so persisting it would
    # orphan the bytes. It is skipped: no media row, no proof image node.
    video = ParsedMedia(kind="video", remote_url="https://video.twimg.com/v.mp4")
    outcome = await _persist(
        db, owner=owner, drafts=[_draft(proof_media=[video])], fetch_media=_image_fetcher
    )
    geo = _row(db, outcome.created[0])
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0
    assert [n for n in geo.proof["content"] if n.get("type") == "image"] == []


async def test_proof_image_kept_when_mixed_with_video(db, owner):
    # A mix of proof image + proof video: only the image persists and is injected
    # into the proof doc; the video is skipped.
    video = ParsedMedia(kind="video", remote_url="https://video.twimg.com/v.mp4")
    outcome = await _persist(
        db, owner=owner, drafts=[_draft(proof_media=[_img(), video])], fetch_media=_image_fetcher
    )
    geo = _row(db, outcome.created[0])
    proof_rows = db.query(Media).filter(Media.event_id == geo.id, Media.role == "proof").all()
    assert len(proof_rows) == 1 and proof_rows[0].media_type == "image"
    assert len([n for n in geo.proof["content"] if n.get("type") == "image"]) == 1


async def test_assemble_persists_detected_row(db, owner):
    # A sourced detection (the quote typology): the declared source URL + date
    # and the quote's media land on the row, the media in the source slot.
    sourced = _draft(
        media=[_img()],
        source_url="https://x.com/src/status/9",
        source_posted_at=datetime(2025, 11, 11, 9, 0, tzinfo=UTC),
    )
    outcome = await _persist(db, owner=owner, drafts=[sourced], fetch_media=_image_fetcher)
    assert len(outcome.created) == 1
    assert len(outcome.skipped) == 0 and len(outcome.updated) == 0

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
    sourced = _draft(
        source_url="https://x.com/src/status/9",
        secondary_source_urls=["https://t.me/channel/11", "https://www.youtube.com/watch?v=M1"],
    )
    outcome = await _persist(db, owner=owner, drafts=[sourced], fetch_media=_image_fetcher)
    geo = _row(db, outcome.created[0])
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

    video = ParsedMedia(kind="video", remote_url="https://video.twimg.com/v.mp4")
    sourced = _draft(media=[_img(), video], source_url="https://x.com/src/status/9")
    outcome = await _persist(db, owner=owner, drafts=[sourced], fetch_media=_both_fetcher)
    assert len(outcome.created) == 1 and outcome.failed == 0

    geo = _row(db, outcome.created[0])
    source_rows = db.query(Media).filter(Media.event_id == geo.id, Media.role == "source").all()
    assert len(source_rows) == 1
    assert source_rows[0].media_type == "image"  # the first entry (photo) wins


async def test_media_less_detection_persists(db, owner):
    # A detected row may be media-incomplete and source-less; the owner
    # completes it before submitting. Unlike a human submit, no media, no
    # source URL, no source date required, and none is fabricated.
    outcome = await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert geo.source_url is None
    assert geo.source_posted_at is None
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0


async def test_unchanged_pair_is_skipped_not_updated(db, owner):
    await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1


async def test_a_pass_that_wrote_a_row_drops_the_points_cache(db, owner):
    """A ``detected`` row is public the moment it lands, so the map must not
    serve a cached payload without it, the same invalidation every human write
    performs."""
    points_cache.set("points:whatever", b"[]")
    await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    assert points_cache.get("points:whatever") is None


async def test_a_pass_that_wrote_nothing_leaves_the_points_cache_alone(db, owner):
    """A second run over the same export writes no row, so it drops nobody's
    cached map: the invalidation follows the write, not the pass."""
    await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    points_cache.set("points:whatever", b"[]")
    outcome = await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    assert len(outcome.skipped) == 1
    assert points_cache.get("points:whatever") == b"[]"


async def test_soft_deleted_pair_is_skipped(db, owner):
    # An admin took the event down. A re-import must not put it back: the row
    # stays removed and no live twin appears beside it.
    await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.deleted_at = datetime.now(UTC)
    db.commit()

    outcome = await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    live = db.query(Event).filter(Event.owner_id == owner.id, Event.deleted_at.is_(None)).all()
    assert live == []


async def test_withheld_pair_is_skipped(db, owner):
    # A takedown freezes the row for its owner too, so a re-import neither
    # overwrites it nor creates a second copy beside it.
    await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.hidden_at = datetime.now(UTC)
    db.commit()
    geo_id, stored_title = geo.id, geo.title

    outcome = await _persist(
        db,
        owner=owner,
        drafts=[_draft(title="Rewritten by the newer parser")],
        fetch_media=_missing_fetcher,
    )
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    db.expire_all()
    rows = db.query(Event).filter(Event.owner_id == owner.id).all()
    assert [r.id for r in rows] == [geo_id]
    assert rows[0].title == stored_title


async def test_closed_detection_is_skipped(db, owner):
    # The owner-reject shape: the row stays visible as ``closed``
    # (before_closed_status='detected'). The rejection is analyst work, so the
    # re-import respects it instead of queueing the same post again.
    await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    geo.before_closed_status = STATUS_DETECTED
    geo.status = "closed"
    geo.closed_at = datetime.now(UTC)
    db.commit()

    outcome = await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    assert outcome.created == [] and len(outcome.skipped) == 1 and len(outcome.updated) == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1
    assert (
        db.query(Event).filter(Event.owner_id == owner.id, Event.status == "detected").all() == []
    )


async def test_same_source_and_coordinate_skips_across_provenance_urls(db, owner):
    # The delete-and-repost duplicate: two different tweets (distinct
    # detected_from_url) declaring the same footage source at the same
    # coordinate are one event — the second detection skips.
    first = _draft(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    second = _draft(url="https://x.com/own/status/2", source_url="https://t.me/chan/1")
    await _persist(db, owner=owner, drafts=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, drafts=[second], fetch_media=_missing_fetcher)
    assert outcome.created == [] and len(outcome.skipped) == 1
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 1


async def test_same_source_different_coordinate_still_creates(db, owner):
    # Same footage can legitimately yield two events at different places (one
    # video, two strikes) — the source_url leg must not collapse them.
    first = _draft(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    second = _draft(
        url="https://x.com/own/status/2", source_url="https://t.me/chan/1", lat=48.6, lng=34.6
    )
    await _persist(db, owner=owner, drafts=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, drafts=[second], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1 and len(outcome.skipped) == 0
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 2


async def test_sourceless_dtos_do_not_dedup_on_null_source(db, owner):
    # Two source-less detections from different posts at the same coordinate
    # stay distinct: NULL source_url declares nothing, so it can't collide.
    first = _draft(url="https://x.com/own/status/1")
    second = _draft(url="https://x.com/own/status/2")
    await _persist(db, owner=owner, drafts=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, drafts=[second], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1 and len(outcome.skipped) == 0


async def test_two_spellings_of_one_post_land_on_one_draft(db, owner):
    # The match anchor is the post id, not the URL: the same post reached
    # through ``twitter.com`` and through ``x.com`` is one geolocation, and the
    # second pass overwrites the draft the first left.
    await _persist(
        db,
        owner=owner,
        drafts=[_draft(url="https://x.com/own/status/7", title="First read")],
        fetch_media=_missing_fetcher,
    )
    outcome = await _persist(
        db,
        owner=owner,
        drafts=[_draft(url="https://twitter.com/Own/status/7", title="Second read")],
        fetch_media=_missing_fetcher,
    )
    assert len(outcome.updated) == 1 and outcome.created == []
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "Second read"
    # The provenance the row was filed under is not the import's to move.
    assert row.detected_from_url == "https://x.com/own/status/7"


async def test_an_archive_thread_then_a_bot_tag_on_its_tail_is_one_draft(db, owner):
    """The cross-entry case the anchor alone could not see.

    A 3-post self-thread A→B→C with the coordinate in C. The export stitches it
    whole and anchors the draft on A; a bot tag on C reads one hop and anchors
    on B. Two anchors, one geolocation, so the match reads the threads' post ids
    and finds the row whichever entry ran first.
    """
    archive = _draft(
        url="https://x.com/own/status/101",
        thread_tweet_ids=(101, 102, 103),
        title="From the export",
    )
    await _persist(db, owner=owner, drafts=[archive], fetch_media=_missing_fetcher, via="archive")

    tagged = _draft(
        url="https://x.com/own/status/102",
        thread_tweet_ids=(102, 103),
        title="From the tag",
    )
    outcome = await _persist(
        db, owner=owner, drafts=[tagged], fetch_media=_missing_fetcher, via="bot"
    )

    assert len(outcome.updated) == 1 and outcome.created == []
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "From the tag"
    # Provenance is not the import's to move, the entry that first read the post
    # included: the row still says where the draft came from.
    assert row.detected_from_url == "https://x.com/own/status/101"
    assert row.detected_thread_tweet_ids == [101, 102, 103]
    assert row.detected_via == "archive"


async def test_a_bot_tag_then_the_archive_of_the_same_thread_is_one_draft(db, owner):
    """The same, in the other order: the export arrives after the tag and lands
    on the row the tag created rather than beside it."""
    tagged = _draft(
        url="https://x.com/own/status/102",
        thread_tweet_ids=(102, 103),
        title="From the tag",
    )
    await _persist(db, owner=owner, drafts=[tagged], fetch_media=_missing_fetcher, via="bot")

    archive = _draft(
        url="https://x.com/own/status/101",
        thread_tweet_ids=(101, 102, 103),
        title="From the export",
    )
    outcome = await _persist(
        db, owner=owner, drafts=[archive], fetch_media=_missing_fetcher, via="archive"
    )

    assert len(outcome.updated) == 1 and outcome.created == []
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "From the export"
    assert row.detected_from_url == "https://x.com/own/status/102"
    assert row.detected_via == "bot"


async def test_two_threads_sharing_no_post_are_two_drafts(db, owner):
    """The overlap is what matches, so two unrelated threads at one coordinate
    still land as two rows: the leg widens the match, it does not collapse
    everything an owner holds at one place."""
    first = _draft(url="https://x.com/own/status/201", thread_tweet_ids=(201, 202))
    second = _draft(url="https://x.com/own/status/301", thread_tweet_ids=(301, 302))
    await _persist(db, owner=owner, drafts=[first], fetch_media=_missing_fetcher)
    outcome = await _persist(db, owner=owner, drafts=[second], fetch_media=_missing_fetcher)

    assert len(outcome.created) == 1 and outcome.updated == []
    assert db.query(Event).filter(Event.owner_id == owner.id).count() == 2


@pytest.mark.parametrize(("via", "tweet_id"), [("bot", 401), ("paste", 402), ("archive", 403)])
async def test_the_entry_that_produced_a_draft_is_stamped_on_the_row(db, owner, via, tweet_id):
    outcome = await _persist(
        db,
        owner=owner,
        drafts=[_draft(url=f"https://x.com/own/status/{tweet_id}")],
        fetch_media=_missing_fetcher,
        via=via,
    )
    [row_id] = outcome.created
    assert _row(db, row_id).detected_via == via


async def test_geolocated_pair_is_skipped(db, owner):
    # A geolocated row already at this (detected_from_tweet_id, coordinate)
    # blocks a machine re-detection.
    _publish_the_default_pair(db, owner)

    outcome = await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    assert len(outcome.skipped) == 1 and outcome.created == []


# ── The upsert: an open draft takes the newer parse in place ───────────────


async def test_detected_draft_is_upserted_in_place(db, owner):
    # The production shape in miniature: the first import stored a source-less,
    # mirror-less, media-less draft; today's parser reads the designation. The
    # newer parse lands on the SAME row, and everything the row is (id, owner,
    # created_at, detected_at, status, provenance) survives it.
    await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before = {
        "id": stored.id,
        "owner_id": stored.owner_id,
        "created_at": stored.created_at,
        "detected_at": stored.detected_at,
        "detected_from_url": stored.detected_from_url,
    }
    assert stored.source_url is None and stored.source_links == []

    richer = _draft(
        title="Depot hit, Shebekino",
        proof_text="Depot hit, Shebekino\nGeolocated by analyst",
        source_url="https://t.me/channel/42",
        source_posted_at=datetime(2025, 11, 11, 9, 0, tzinfo=UTC),
        secondary_source_urls=["https://www.youtube.com/watch?v=M1"],
        media=[_img()],
    )
    outcome = await _persist(db, owner=owner, drafts=[richer], fetch_media=_image_fetcher)
    assert outcome.created == [] and len(outcome.updated) == 1 and len(outcome.skipped) == 0

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


async def test_a_re_import_whose_fetch_comes_back_short_keeps_the_stored_media(db, owner):
    """A CDN answering nothing is not the post losing its media.

    Every fetch failure used to resolve to an empty media list, which the upsert
    read as "the post has no media any more": it deleted every ``Media`` row and
    swept the objects, for an outage that clears on its own.
    """
    await _persist(
        db,
        owner=owner,
        drafts=[_draft(media=[_img()], proof_media=[_img()])],
        fetch_media=_image_fetcher,
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before = {(m.role, m.storage_url, m.sha256) for m in stored.media}
    keys = {get_storage().key_from_url(url) for _role, url, _sha in before}
    assert len(before) == 2

    outcome = await _persist(
        db,
        owner=owner,
        # Same post, same coordinate, a newer title: the write path has
        # something to update, and the fetcher answers nothing for the media.
        drafts=[_draft(media=[_img()], proof_media=[_img()], title="Corrected wording")],
        fetch_media=_missing_fetcher,
    )
    assert len(outcome.updated) == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.title == "Corrected wording"
    assert {(m.role, m.storage_url, m.sha256) for m in row.media} == before
    for key in keys:
        assert key is not None and get_storage().get_bytes(key)
    # The proof document still points at the image that is still stored.
    assert [n["attrs"]["src"] for n in row.proof["content"] if n.get("type") == "image"] == [
        url for role, url, _sha in sorted(before) if role == "proof"
    ]


async def test_a_re_import_that_only_loses_its_media_moves_nothing(db, owner):
    """The same, with nothing else to write: the row is left exactly as it is
    and the pass counts it skipped rather than updated."""
    await _persist(db, owner=owner, drafts=[_draft(media=[_img()])], fetch_media=_image_fetcher)
    db.expire_all()
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    updated_at = stored.updated_at

    outcome = await _persist(
        db, owner=owner, drafts=[_draft(media=[_img()])], fetch_media=_missing_fetcher
    )
    assert outcome.updated == [] and outcome.skipped == [stored.id]

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.updated_at == updated_at
    assert [m.role for m in row.media] == ["source"]


async def test_a_pass_that_wrote_nothing_reports_no_warnings(db, owner):
    """Warnings are what review has to answer on the rows the pass wrote.

    A draft whose match is a published row is left alone, so there is no draft
    to go and look at and nothing to warn about.
    """
    _publish_the_default_pair(db, owner)

    outcome = await _persist(db, owner=owner, drafts=[_draft()], fetch_media=_missing_fetcher)

    assert len(outcome.skipped) == 1 and outcome.created == [] and outcome.updated == []
    assert outcome.warnings == {}


async def test_the_warnings_count_the_rows_the_pass_wrote(db, owner):
    """Two drafts, one already published: only the one that landed is counted."""
    _publish_the_default_pair(db, owner)

    outcome = await _persist(
        db,
        owner=owner,
        drafts=[_draft(), _draft(lat=50.0, lng=30.0, url="https://x.com/own/status/2")],
        fetch_media=_missing_fetcher,
    )

    assert len(outcome.created) == 1 and len(outcome.skipped) == 1
    assert outcome.warnings == {SOURCE_FOOTAGE_MISSING: 1, SOURCE_DATE_UNKNOWN: 1}


async def test_upsert_replaces_source_media_and_sweeps_the_old_objects(db, owner):
    # Replacing the footage drops the old row AND its objects, but only once the
    # transaction that dropped the row has landed (commit-then-sweep).
    await _persist(db, owner=owner, drafts=[_draft(media=[_img()])], fetch_media=_image_fetcher)
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    old = db.query(Media).filter(Media.event_id == stored.id, Media.role == "source").one()
    old_key = get_storage().key_from_url(old.storage_url)
    assert old_key is not None and get_storage().get_bytes(old_key)

    async def other_image(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return OTHER_JPEG, "image/jpeg"

    outcome = await _persist(
        db, owner=owner, drafts=[_draft(media=[_img()])], fetch_media=other_image
    )
    assert len(outcome.updated) == 1

    db.expire_all()
    fresh = db.query(Media).filter(Media.event_id == stored.id, Media.role == "source").one()
    assert fresh.sha256 != old.sha256
    with pytest.raises(FileNotFoundError):
        get_storage().get_bytes(old_key)


async def test_upsert_rewrites_proof_media_and_the_nodes_that_carry_it(db, owner):
    # Proof images live in the proof document, so a media replacement has to
    # move both halves or the document points at a swept object.
    await _persist(
        db, owner=owner, drafts=[_draft(proof_media=[_img()])], fetch_media=_image_fetcher
    )
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    old_src = stored.proof["content"][-1]["attrs"]["src"]

    async def other_image(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return OTHER_JPEG, "image/jpeg"

    outcome = await _persist(
        db, owner=owner, drafts=[_draft(proof_media=[_img()])], fetch_media=other_image
    )
    assert len(outcome.updated) == 1

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
    first = _draft(url="https://x.com/own/status/1", source_url="https://t.me/chan/1")
    await _persist(db, owner=owner, drafts=[first], fetch_media=_missing_fetcher)
    stored_id = db.query(Event).filter(Event.owner_id == owner.id).one().id

    second = _draft(
        url="https://x.com/own/status/2",
        source_url="https://t.me/chan/1",
        title="Corrected wording",
    )
    outcome = await _persist(db, owner=owner, drafts=[second], fetch_media=_missing_fetcher)
    assert outcome.created == [] and len(outcome.updated) == 1

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
    first = _draft(source_url="https://t.me/chan/1")
    await _persist(db, owner=owner, drafts=[first], fetch_media=_missing_fetcher)
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    stage_source_snapshot(
        db,
        event=row,
        snapshot_url="https://web.archive.org/web/20260101120000/https://t.me/chan/1",
    )
    db.commit()
    assert len(row.archives) == 1

    moved = _draft(source_url="https://t.me/chan/2")
    outcome = await _persist(db, owner=owner, drafts=[moved], fetch_media=_missing_fetcher)
    assert len(outcome.updated) == 1

    db.expire_all()
    fresh = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert fresh.source_url == "https://t.me/chan/2"
    assert fresh.archives == []


async def test_reimporting_the_same_detection_twice_writes_nothing(db, owner):
    # Idempotence, the whole promise: no field churn, no proof rewrite, no media
    # re-upload, no new objects in the bucket, and ``updated_at`` does not move.
    draft = _draft(
        source_url="https://t.me/chan/1",
        secondary_source_urls=["https://www.youtube.com/watch?v=M1"],
        media=[_img()],
        proof_media=[_img()],
    )
    await _persist(db, owner=owner, drafts=[draft], fetch_media=_image_fetcher)
    stored = db.query(Event).filter(Event.owner_id == owner.id).one()
    before_updated_at = stored.updated_at
    before_media = {(m.id, m.storage_url, m.sha256) for m in stored.media}
    before_objects = _stored_objects(stored.id)

    outcome = await _persist(db, owner=owner, drafts=[draft], fetch_media=_image_fetcher)
    assert outcome.created == [] and len(outcome.updated) == 0 and len(outcome.skipped) == 1

    db.expire_all()
    row = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert row.updated_at == before_updated_at
    assert {(m.id, m.storage_url, m.sha256) for m in row.media} == before_media
    assert _stored_objects(row.id) == before_objects


async def test_a_backfill_refuses_an_owner_with_no_linked_handle(db, owner):
    """The handle is the precondition, never a fallback onto the username: the
    provenance permalinks and the own-status exclusion are both written from it,
    so an unlinked owner refuses the run rather than importing under a name that
    may be someone else's on X. The worker's gate answers the analyst
    (``archive_jobs.process``); this is the backstop behind it."""
    owner.x_handle = None
    db.commit()

    with pytest.raises(ValueError):
        await backfill_from_archive(db, owner=owner, archive_dir=ARCHIVE)
    assert db.query(Event).filter(Event.owner_id == owner.id).all() == []


async def test_thread_media_fetched_and_prepared_once_across_coordinates(db, owner):
    # Two coordinates from the same post (same detected_from_url + media) → two
    # rows, but the shared image is fetched / stripped only once (cache).
    calls = {"n": 0}

    async def counting_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        calls["n"] += 1
        return TINY_JPEG, "image/jpeg"

    img = _img()
    detections = [
        _draft(lat=48.5, lng=34.5, url="https://x.com/own/status/9", media=[img]),
        _draft(lat=50.0, lng=30.0, url="https://x.com/own/status/9", media=[img]),
    ]
    outcome = await _persist(db, owner=owner, drafts=detections, fetch_media=counting_fetcher)
    assert len(outcome.created) == 2
    assert calls["n"] == 1  # fetched once, shared across both coordinate rows
    geo_ids = outcome.created
    assert db.query(Media).filter(Media.event_id.in_(geo_ids)).count() == 2


async def test_unusable_media_is_skipped_and_detection_still_persists(db, owner):
    # An undecodable image must not abort the detection — it persists
    # media-incomplete, not failed.
    async def bad_image_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return b"this is not a real image", "image/jpeg"

    outcome = await _persist(
        db, owner=owner, drafts=[_draft(media=[_img()])], fetch_media=bad_image_fetcher
    )
    assert len(outcome.created) == 1 and outcome.failed == 0
    geo = db.query(Event).filter(Event.owner_id == owner.id).one()
    assert db.query(Media).filter(Media.event_id == geo.id).count() == 0


async def test_over_cap_media_is_skipped_and_detection_still_persists(db, owner, monkeypatch):
    # The other half of the unusable-media surface: bytes that decode fine but
    # sit over ``max_image_size``. The size guard is the same ``ValueError`` the
    # undecodable image raises, so the draft lands media-incomplete rather than
    # failing, on both roles at once. The empty source slot is then reported as
    # ``source_footage_missing``: the source photo was the one dropped, and the
    # source date came back, so that is the only warning the row earns.
    monkeypatch.setattr(settings, "max_image_size", len(TINY_JPEG) - 1)

    async def over_cap_fetcher(_parsed: ParsedMedia) -> tuple[bytes, str]:
        return TINY_JPEG, "image/jpeg"

    draft = _draft(
        source_url="https://t.me/chan/42",
        source_posted_at=datetime(2025, 11, 11, 8, 0, tzinfo=UTC),
        media=[_img()],
        # A second URL, since the fetch + prepare cache keys on it: one shared
        # URL would make this a single media in two roles.
        proof_media=[ParsedMedia(kind="image", remote_url="https://pbs.twimg.com/media/y.jpg")],
    )
    outcome = await _persist(db, owner=owner, drafts=[draft], fetch_media=over_cap_fetcher)

    assert len(outcome.created) == 1 and outcome.failed == 0
    assert outcome.warnings == {SOURCE_FOOTAGE_MISSING: 1}
    row = _row(db, outcome.created[0])
    assert db.query(Media).filter(Media.event_id == row.id).count() == 0
    assert not [node for node in row.proof["content"] if node.get("type") == "image"]


async def test_failed_detection_is_isolated_not_lost(db, owner, monkeypatch):
    # One detection raising mid-persist is caught, counted, rolled back — the
    # others still land, and no partial row survives.
    async def boom(*_a, **_k):
        raise RuntimeError("upload exploded")

    monkeypatch.setattr("app.services.detection.upload_prepared_media", boom)

    bad = _draft(lat=48.5, lng=34.5, url="https://x.com/own/status/11", media=[_img()])
    good = _draft(lat=50.0, lng=30.0, url="https://x.com/own/status/12")  # no media
    outcome = await _persist(db, owner=owner, drafts=[bad, good], fetch_media=_image_fetcher)
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


# ── The warnings the write path raises ────────────────────────────────────


async def test_a_sourced_draft_that_stored_no_footage_warns(db, owner):
    """The three warnings only the write path can answer, on one created row:
    the source was declared but no ``role=source`` media landed, and its post
    date came back unknown. The engine's own warnings are unaffected."""
    draft = _draft(
        source_url="https://t.me/chan/42",
        media=[_img()],
        source_posted_at=None,
    )
    outcome = await _persist(db, owner=owner, drafts=[draft], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {SOURCE_FOOTAGE_MISSING: 1, SOURCE_DATE_UNKNOWN: 1}


async def test_a_source_the_chase_could_not_reach_warns_that_it_may_come_back(db, owner):
    """A footage-less row whose chase died on an upstream that would not answer
    reads differently to one whose source simply carries no footage: the same
    import later may well fill it, so the warning says to run it again rather
    than to go and find the footage by hand."""
    draft = _draft(
        source_url="https://t.me/chan/42",
        media=[_img()],
        source_posted_at=None,
        source_fetch_failed=True,
    )
    outcome = await _persist(db, owner=owner, drafts=[draft], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {SOURCE_FETCH_FAILED: 1, SOURCE_DATE_UNKNOWN: 1}


async def test_a_draft_with_footage_and_a_source_date_warns_about_neither(db, owner):
    draft = _draft(
        source_url="https://t.me/chan/42",
        media=[_img()],
        source_posted_at=datetime(2025, 11, 11, 8, 0, tzinfo=UTC),
    )
    outcome = await _persist(db, owner=owner, drafts=[draft], fetch_media=_image_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {}


async def test_an_empty_source_slot_suppresses_the_footage_and_date_warnings(db, owner):
    """A draft the engine already flagged source-less carries no footage or date
    warning: the empty slot says why there is neither, and repeating it would
    cost the bot's reply two lines for one fact."""
    draft = _draft(media=[_img()])
    draft = dataclasses.replace(draft, warnings=[SOURCE_MISSING])
    outcome = await _persist(db, owner=owner, drafts=[draft], fetch_media=_missing_fetcher)
    assert len(outcome.created) == 1
    assert outcome.warnings == {SOURCE_MISSING: 1}


async def test_media_already_on_another_event_warns_once_per_row(db, owner):
    """Exact sha256 equality against events outside the pass. The pass's own
    rows are excluded, so the two coordinate drafts of one post, which share
    the media, do not flag each other; a later import of the same bytes does."""
    first = await _persist(
        db, owner=owner, drafts=[_draft(proof_media=[_img()])], fetch_media=_image_fetcher
    )
    assert len(first.created) == 1
    assert DUPLICATE_MEDIA not in first.warnings

    second = await _persist(
        db,
        owner=owner,
        drafts=[
            _draft(url="https://x.com/own/status/2", lat=49.5, proof_media=[_img()]),
            _draft(url="https://x.com/own/status/3", lat=50.5, proof_media=[_img()]),
        ],
        fetch_media=_image_fetcher,
    )
    assert len(second.created) == 2
    assert second.warnings[DUPLICATE_MEDIA] == 2
