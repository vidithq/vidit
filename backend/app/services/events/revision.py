"""The correction of a published event, filed as a version."""

from __future__ import annotations

from datetime import date, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_GEOLOCATED, Event
from app.models.user import User
from app.schemas.source import SourceCreate
from app.services import versions
from app.services.event_filters import lock_event
from app.services.evidence_intake import attach_evidence_and_commit
from app.services.permissions import ensure_owner

from .coordinates import validate_coordinates
from .errors import EventStateError, NothingChangedError
from .rules import (
    _require_conflict,
    _require_proof_image,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
)
from .sources import (
    apply_sources,
    check_publish_floor,
    comparable,
    plan_sources,
    planned_floor,
)


async def save_version(
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
    note: str | None = None,
) -> Event:
    """Correct a published event, filing the superseded state as a version.

    Owner-only, and only on a ``geolocated`` row (before publication there is
    no vouched version to supersede). The pre-edit state is snapshotted into
    ``event_versions`` at the current ``version_no``, the edit is applied, and
    the row takes the next number, in one transaction under the row lock
    :func:`close` and :func:`geolocate` take.

    **The sources are editable and versioned.** The posted list replaces the stored one
    (``sources.apply_sources``) and the snapshot keeps each source as it stood, its file
    included (``services/versions.build_snapshot``), so ``/vN`` shows what the claim rested
    on then. A dropped source's stored object stays while a readable version renders it; it
    goes with the event's deletion or the redaction of the last version naming it.

    The floor is re-checked against the post-edit state: a ``direct`` or ``indirect`` source
    with its file and every file's sensor, a proof image in the final proof body, and a
    conflict. An image the new body drops is deleted only if no readable version displays it
    (``services/versions.referenced_media_urls``).

    **A version has to change something.** Incoming state is compared with the live row on
    ``services/versions.COMPARED_FIELDS`` and on the sources (``sources.comparable``); an edit
    that moves none raises :class:`NothingChangedError` before the version is filed or any
    upload runs. A new upload counts as a change by construction.

    **A save that only archives is exempt from the version ceiling**
    (``MAX_VERSIONS_PER_EVENT``): when the only change is a link's archived copy, a source
    that dies at the ceiling can still be archived.

    Raises :class:`EventStateError` (409) off ``geolocated``, the 403 of
    ``ensure_owner``, :class:`NothingChangedError` (409),
    ``services/versions.VersionLimitError`` (409) at the ceiling, and the errors of
    ``create_with_evidence``.
    """
    # Same lock as ``geolocate`` and ``close``: concurrent edits take their
    # ``version_no`` in a defined order.
    geo = lock_event(db, geo.id)
    ensure_owner(geo, current_user)
    if geo.status != STATUS_GEOLOCATED:
        raise EventStateError("Only a geolocated event can be edited")

    validate_coordinates(lat, lng)
    proof_data = _sanitize_proof(proof_data)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_conflict(effective_conflicts)
    planned = plan_sources(db, geo=geo, specs=sources, uploader=current_user)
    check_publish_floor(planned_floor(planned))

    # An edit that moves nothing is refused: a version spends a number in a
    # public address space (``/events/{id}/vN``) and must record a real change.
    # The note is not compared.
    proposed = {
        "title": title,
        "coords": {"lat": lat, "lng": lng},
        "occurred_date": occurred_date.isoformat() if occurred_date is not None else None,
        "occurred_time": occurred_time.isoformat() if occurred_time is not None else None,
        "tags": versions.tag_entries(effective_tags),
        "conflicts": versions.conflict_entries(effective_conflicts),
        "proof": proof_data if proof_data is not None else geo.proof,
    }
    # Built once: serves the no-change check and the filed snapshot.
    current_snapshot = versions.build_snapshot(geo)
    fields_move = not versions.matches_current(current_snapshot, proposed) or comparable(
        geo.sources, archives=False
    ) != comparable(planned, archives=False)
    # Archived copies are their own leg: only a pasted copy moves.
    copies_move = comparable(geo.sources, archives=True) != comparable(planned, archives=True)
    if not fields_move and not copies_move:
        raise NothingChangedError(f"Nothing changed since version {geo.version_no}.")

    # File the superseded version BEFORE any field moves (the snapshot reads the
    # live collections). It also protects that version's images from the
    # intake's proof diff. The ceiling spares a save that only archives.
    versions.file_version(
        db,
        geo=geo,
        edited_by=current_user,
        note=note,
        snapshot=current_snapshot,
        enforce_ceiling=fields_move,
    )

    # The collection assignments lazy-load, which would flush a half-edited row.
    with db.no_autoflush:
        geo.title = title
        geo.coords = from_shape(Point(lng, lat), srid=4326)
        geo.occurred_date = occurred_date
        geo.occurred_time = occurred_time
        geo.tags = effective_tags
        geo.conflicts = effective_conflicts
    # The version filed above renders the dropped files, so the sweep keeps them.
    removed = apply_sources(db, geo, planned)

    await attach_evidence_and_commit(
        db,
        event=geo,
        proof_html=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} save_version rollback",
        removed=removed,
    )

    db.refresh(geo)
    # Coordinates may have moved.
    points_cache.invalidate()
    return geo
