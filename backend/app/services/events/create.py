"""The direct create: a ``geolocated`` row born with its full evidence."""

from __future__ import annotations

from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import Event
from app.models.user import User
from app.services import source_archive
from app.services.evidence_intake import attach_evidence_and_commit

from .coordinates import _optional_point, validate_coordinates
from .rules import (
    _credit_geolocator,
    _require_proof_image,
    _require_submission_floor,
    _require_submission_media,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .source_links import (
    build_source_link_rows,
    normalize_secondary_source_urls,
    pair_secondary_snapshots,
)


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    capture_source_lat: float | None,
    capture_source_lng: float | None,
    source_url: str,
    secondary_source_urls: list[str],
    event_date: date | None,
    event_time: time | None = None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    file: UploadFile,
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Create a ``geolocated`` event with its evidence (a direct geolocate).

    The creator is stamped ``geolocated_at`` and credited in ``event_geolocators``.

    The full evidence floor applies: subject coordinates, exactly one source
    file, a proof image (a ``placeholder://`` src resolved from
    ``proof_files``, see ``evidence_intake``), a conflict, and a
    ``capture_source`` tag. The camera point (``capture_source_lat`` / ``lng``)
    is optional, both-or-neither.

    ``source_snapshot_url`` and ``secondary_snapshot_urls`` (aligned with
    ``secondary_source_urls``) are archived copies checked by
    ``services/source_archive`` and stored in this transaction. A rejected
    paste (:class:`SnapshotRejected`) raises before any upload.

    Raises :class:`EvidenceIntakeError` subclasses: bad coordinates, no source
    file, invalid or image-less proof, missing conflict or tag, too many
    secondary links, or a file/proof intake failure.

    Any failure rolls back and best-effort sweeps the S3 keys already written.
    """
    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    # Paired off the raw list, before normalization renumbers it.
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, source_url)

    _require_submission_media(file is not None)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # Check the rest of the floor before any upload to save the S3 round-trip.
    _require_proof_image(proof_data)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    geo = Event(
        owner_id=current_user.id,
        title=title,
        event_coords=from_shape(Point(lng, lat), srid=4326),
        capture_source_coords=capture_point,
        source_url=source_url,
        # ``proof`` lands via the intake below; the model default covers NOT NULL until then.
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        is_graphic=is_graphic,
        geolocated_at=datetime.now(UTC),
    )
    geo.tags = effective_tags
    geo.conflicts = effective_conflicts
    geo.source_links = build_source_link_rows(secondary_links)

    db.add(geo)
    db.flush()
    _credit_geolocator(db, geo, current_user)

    # Staged after the flush (rows need the event id) and before the first
    # upload, so a rejected paste costs no S3 round-trip.
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=[file],
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context="event create rollback",
    )

    db.refresh(geo)
    points_cache.invalidate()
    return geo
