"""The one write that files a version: correct a published event, or publish a request or a
detection."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, STATUS_REQUESTED, Event
from app.models.user import User
from app.services import geolocator_credit, notifications, versions
from app.services.event_filters import lock_event
from app.services.permissions import ensure_owner

from .coordinates import validate_coordinates
from .errors import EventStateError, NothingChangedError, VersionMismatchError
from .form import EventForm, commit_form, prepare_form, write_form
from .rules import _credit_geolocator
from .sources import comparable

# The states this write accepts. The first two are version 0 and leave it published.
_UNPUBLISHED = (STATUS_REQUESTED, STATUS_DETECTED)
_WRITABLE = (*_UNPUBLISHED, STATUS_GEOLOCATED)


async def save_version(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    form: EventForm,
    lat: float,
    lng: float,
    note: str | None = None,
    expected_version: int | None = None,
    geolocator_invites: Sequence[str] = (),
) -> Event:
    """Write the posted form onto the event and file the state it supersedes as a version.

    Publishing is this write on version 0. Locked like :func:`close` and :func:`update_request`,
    so racing writes serialize. ``expected_version`` is checked before the ownership check, so
    the loser of a racing publish or edit reads a conflict, not a 403 on a row that changed
    hands. A dropped source's stored object stays while a readable version renders it.
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
    prepared = prepare_form(db, form, geo=geo, uploader=current_user, publication=True)
    proof = prepared.proof if prepared.proof is not None else geo.proof

    # An edit that moves nothing is refused: a version spends a number in a
    # public address space (``/events/{id}/vN``) and must record a real change.
    # The note is not compared.
    proposed = {
        "title": form.title,
        "coords": {"lat": lat, "lng": lng},
        "occurred_date": (
            form.occurred_date.isoformat() if form.occurred_date is not None else None
        ),
        "occurred_time": (
            form.occurred_time.isoformat() if form.occurred_time is not None else None
        ),
        "tags": versions.tag_entries(prepared.tags),
        "conflicts": versions.conflict_entries(prepared.conflicts),
        "proof": proof,
    }
    # Built once: serves the no-change check and the filed snapshot.
    current_snapshot = versions.build_snapshot(geo)
    planned = prepared.sources
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

    write_form(db, geo, form, prepared, from_shape(Point(lng, lat), srid=4326))
    if publishing:
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
        # Hands edit-rights to the fulfiller of a request and records the credit.
        _credit_geolocator(db, geo, current_user)
        geolocator_credit.invite_on_publish(db, geo=geo, usernames=geolocator_invites)
    if fulfils_request:
        notifications.notify_request_fulfilled(db, event=geo, fulfiller=current_user)
    # The version filed above renders the dropped files, so the sweep keeps them.
    await commit_form(
        db, geo, form, prepared, sweep_context=f"event {geo.id} save_version rollback"
    )
    # Coordinates may have moved, and a publish puts the row on the map.
    points_cache.invalidate()
    return geo
