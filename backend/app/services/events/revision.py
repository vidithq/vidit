"""The one write that files a version: correct a published event, or publish a request or a
detection."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, STATUS_REQUESTED, Event
from app.models.user import User
from app.schemas.source import SourceCreate
from app.services import geolocator_credit, notifications, versions
from app.services.event_filters import lock_event
from app.services.evidence_intake import attach_evidence_and_commit
from app.services.permissions import ensure_owner

from .coordinates import validate_coordinates
from .errors import EventStateError, NothingChangedError, VersionMismatchError
from .rules import (
    _credit_geolocator,
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

# The states this write accepts. The first two are version 0 and leave it published.
_UNPUBLISHED = (STATUS_REQUESTED, STATUS_DETECTED)
_WRITABLE = (*_UNPUBLISHED, STATUS_GEOLOCATED)


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
    expected_version: int | None = None,
    geolocator_invites: Sequence[str] = (),
) -> Event:
    """Write the posted form onto the event and file the state it supersedes as a version.

    The pre-edit state is snapshotted into ``event_versions`` at the current ``version_no``,
    the edit is applied, and the row takes the next number, in one transaction under the row
    lock :func:`close` and :func:`update_request` take, so two racing writes serialize.

    **Publishing is this write on version 0.** A ``requested`` or ``detected`` row is version
    0; the write files it as version 0 (what the import or the requester left) and the row
    becomes version 1, ``geolocated``, stamped ``geolocated_at``, with the caller credited in
    ``event_geolocators``. A detection is owner-only. A request is answerable by anyone:
    ``owner_id`` transfers to the caller, ``requested_by_id`` keeps the poster, and the
    requester is notified. A publish always moves something (the status), so the no-change
    check below does not apply to it. Each of ``geolocator_invites`` is invited to share the
    credit right after the row is published, in the same transaction
    (``geolocator_credit.invite_on_publish``); a refused one rolls back the whole publish. A
    ``geolocated`` row takes none (409 ``invalid_state``): its owner invites through
    ``geolocator_credit.invite``.

    A ``geolocated`` row is owner-only. Any other state raises :class:`EventStateError` (409),
    so a racing close gives the loser a 409. ``expected_version`` is the version the caller's
    form was loaded at: a row that moved past it raises :class:`VersionMismatchError` (409)
    before the ownership check, so the loser of a racing publish or edit reads a conflict, not
    a 403 on a row that changed hands.

    **The sources are editable and versioned.** The posted list replaces the stored one
    (``sources.apply_sources``) and the snapshot keeps each source as it stood, its file
    included (``services/versions.build_snapshot``), so ``/vN`` shows what the claim rested
    on then. A dropped source's stored object stays while a readable version renders it; it
    goes with the event's deletion or the redaction of the last version naming it. A source's
    ``is_graphic`` ratchets: a posted false leaves a flagged source flagged.

    The floor is checked against the post-edit state before any upload: coordinates, a
    ``direct`` or ``indirect`` source with its file, a proof image in the final proof body, and
    a conflict. An image the new body drops is deleted only if no readable version displays it
    (``services/versions.referenced_media_urls``).

    **An edit has to change something.** Incoming state is compared with the live row on
    ``services/versions.COMPARED_FIELDS`` and on the sources (``sources.comparable``); an edit
    that moves none raises :class:`NothingChangedError` before the version is filed or any
    upload runs. A new upload counts as a change by construction.

    **A save that only archives is exempt from the version ceiling**
    (``MAX_VERSIONS_PER_EVENT``): when the only change is a link's archived copy, a source
    that dies at the ceiling can still be archived.

    Raises :class:`EventStateError` (409), :class:`VersionMismatchError` (409), the 403 of
    ``ensure_owner``, :class:`NothingChangedError` (409), ``services/versions.VersionLimitError`` (409) at the
    ceiling, and the errors of ``create_with_evidence``, ``GeolocatorCreditError`` included.
    """
    geo = lock_event(db, geo.id)
    if geo.status not in _WRITABLE:
        raise EventStateError("Only a request, a detection or a geolocated event can be edited")
    if expected_version is not None and expected_version != geo.version_no:
        raise VersionMismatchError(
            f"This event is at version {geo.version_no}; reload it before saving"
        )
    publishing = geo.status in _UNPUBLISHED
    if geolocator_invites and not publishing:
        raise EventStateError(
            "A published event invites its geolocators through its geolocator invitations"
        )
    fulfils_request = geo.status == STATUS_REQUESTED
    if not fulfils_request:
        ensure_owner(geo, current_user)

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
    fields_move = (
        publishing
        or not versions.matches_current(current_snapshot, proposed)
        or comparable(geo.sources, archives=False) != comparable(planned, archives=False)
    )
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
        if publishing:
            geo.status = STATUS_GEOLOCATED
            geo.geolocated_at = datetime.now(UTC)
    if publishing:
        # Hands edit-rights to the fulfiller of a request and records the credit.
        _credit_geolocator(db, geo, current_user)
        geolocator_credit.invite_on_publish(db, geo=geo, usernames=geolocator_invites)
    if fulfils_request:
        notifications.notify_request_fulfilled(db, event=geo, fulfiller=current_user)
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
    # Coordinates may have moved, and a publish puts the row on the map.
    points_cache.invalidate()
    return geo
