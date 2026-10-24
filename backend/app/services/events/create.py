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
from app.schemas.source import SourceCreate
from app.services.evidence_intake import attach_evidence_and_commit

from .coordinates import validate_coordinates
from .rules import (
    _credit_geolocator,
    _require_conflict,
    _require_proof_image,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .sources import apply_sources, check_publish_floor, plan_sources, planned_floor


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    occurred_date: date | None,
    occurred_time: time | None = None,
    proof_data: str | None,
    tag_ids: list,
    conflict_ids: list,
    sources: list[SourceCreate],
    proof_files: list[UploadFile],
) -> Event:
    """Create a ``geolocated`` event with its evidence (a direct geolocate).

    The creator is stamped ``geolocated_at`` and credited in ``event_geolocators``.

    The full floor applies: subject coordinates, a ``direct`` or ``indirect`` source with its
    file and every file's sensor (``sources.check_publish_floor``), a proof image (a
    ``placeholder://`` src resolved from ``proof_files``, see ``evidence_intake``), and a
    conflict.

    Raises :class:`EvidenceIntakeError` subclasses: bad coordinates, an unmet floor, invalid or
    image-less proof, a source list past its caps or naming an unknown upload or file, or a
    proof intake failure; ``SnapshotRejected`` for a pasted copy that is not a snapshot. Every
    check runs before the first upload; any later failure rolls back and sweeps what landed.
    """
    validate_coordinates(lat, lng)
    proof_data = _sanitize_proof(proof_data)
    _require_proof_image(proof_data)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_conflict(effective_conflicts)
    planned = plan_sources(db, geo=None, specs=sources, uploader=current_user)
    check_publish_floor(planned_floor(planned))

    geo = Event(
        owner_id=current_user.id,
        title=title,
        coords=from_shape(Point(lng, lat), srid=4326),
        # ``proof`` lands via the intake below; the model default covers NOT NULL until then.
        occurred_date=occurred_date,
        occurred_time=occurred_time,
        geolocated_at=datetime.now(UTC),
    )
    geo.tags = effective_tags
    geo.conflicts = effective_conflicts

    db.add(geo)
    db.flush()
    _credit_geolocator(db, geo, current_user)
    apply_sources(db, geo, planned)

    await attach_evidence_and_commit(
        db,
        event=geo,
        proof_html=proof_data,
        proof_files=proof_files,
        sweep_context="event create rollback",
    )

    db.refresh(geo)
    points_cache.invalidate()
    return geo
