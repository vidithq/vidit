"""The promotion to ``geolocated``: fulfil a request or vouch a detection."""

from __future__ import annotations

from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, STATUS_REQUESTED, Event
from app.models.user import User
from app.schemas.source import SourceCreate
from app.services import notifications
from app.services.event_filters import lock_event
from app.services.evidence_intake import attach_evidence_and_commit
from app.services.permissions import ensure_owner

from .coordinates import validate_coordinates
from .errors import EventStateError
from .rules import (
    _credit_geolocator,
    _require_conflict,
    _require_proof_image,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .sources import apply_sources, check_publish_floor, plan_sources, planned_floor


async def geolocate(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    occurred_date: date | None,
    occurred_time: time | None,
    proof_data: str | None,
    tag_ids: list,
    conflict_ids: list,
    sources: list[SourceCreate],
    proof_files: list[UploadFile],
) -> Event:
    """Transition a ``requested`` or ``detected`` event to ``geolocated``.

    Folds request fulfilment and detection submit into one step. The form posts the whole
    state, its ``sources`` included, which replace the stored ones (``sources.apply_sources``):
    the requester's sources are not locked, so a fulfiller corrects them like any field. The
    row is stamped ``geolocated_at`` and the caller is credited in ``event_geolocators``. Later
    edits go through :func:`save_version`. ``detected_from_url`` and ``status`` carry no form
    field.

    A source's ``is_graphic`` ratchets: a posted false leaves a flagged source flagged.
    Clearing is admin-only (``PATCH /admin/events/{id}/moderation``).

    The row is re-fetched ``with_for_update()`` first and the status re-checked,
    so two racing geolocates serialize and the loser sees the 409.

    * ``detected``: owner-only (403 otherwise); the owner stays.
    * ``requested``: anyone may answer. ``owner_id`` transfers to
      ``current_user`` and ``requested_by_id`` keeps the original poster.

    The floor of a direct create is enforced here before any upload: a ``direct`` or
    ``indirect`` source with its file and every file's sensor, a proof image in the final
    proof body, and a conflict. Field updates, sources, proof images, the owner transfer and
    the state flip commit in one transaction; a file the edit dropped is swept after it.

    Raises :class:`EventStateError` (409) off ``requested`` / ``detected``, and the errors of
    ``create_with_evidence``.
    """
    # The re-read under lock stops a concurrent loser from double-fulfilling.
    geo = lock_event(db, geo.id)
    if geo.status not in (STATUS_REQUESTED, STATUS_DETECTED):
        raise EventStateError("Only requested or detected events can be geolocated")
    if geo.status == STATUS_DETECTED:
        ensure_owner(geo, current_user)
    fulfils_request = geo.status == STATUS_REQUESTED

    validate_coordinates(lat, lng)
    proof_data = _sanitize_proof(proof_data)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_conflict(effective_conflicts)
    planned = plan_sources(db, geo=geo, specs=sources, uploader=current_user)
    check_publish_floor(planned_floor(planned))

    # The ``geo.tags`` assignment lazy-loads, which would flush a half-mutated row.
    with db.no_autoflush:
        geo.title = title
        geo.coords = from_shape(Point(lng, lat), srid=4326)
        geo.occurred_date = occurred_date
        geo.occurred_time = occurred_time
        geo.tags = effective_tags
        geo.conflicts = effective_conflicts
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
    # Hands edit-rights to the fulfiller of a request and records the credit.
    _credit_geolocator(db, geo, current_user)
    if fulfils_request:
        notifications.notify_request_fulfilled(db, event=geo, fulfiller=current_user)
    removed = apply_sources(db, geo, planned)

    await attach_evidence_and_commit(
        db,
        event=geo,
        proof_html=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} geolocate rollback",
        removed=removed,
    )

    db.refresh(geo)
    points_cache.invalidate()
    return geo
