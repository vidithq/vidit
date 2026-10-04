"""Shared helpers for the events sub-routers (``read`` / ``write`` / ``item``),
kept here so none imports another: the typed-error to HTTP envelopes, the
``EventRead`` / ``EventList`` assemblers (also imported by the users and social
routers), the projection helpers and :func:`resolve_live_event`.
"""

import uuid
from typing import Annotated, NoReturn

from fastapi import HTTPException
from pydantic import StringConstraints
from sqlalchemy.orm import Session

from app.models.event import SOURCE_URL_MAX_LENGTH, Event, EventVersion
from app.routers._errors import raise_typed_error
from app.schemas.event import (
    ArchivedLinkRead,
    CoordsRead,
    EventList,
    EventRead,
    EventVersionRead,
)
from app.schemas.media import MediaRead
from app.services.event_filters import visible_events
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError
from app.services.source_archive import SnapshotRejected, archive_row_for
from app.services.thumbnails import pick_thumbnail
from app.services.versions import VersionLimitError

# Item type of the repeated ``secondary_source_urls`` field. The ceiling rides
# on the item: ``max_length`` on the ``list[str]`` would cap the entry count.
SecondarySourceUrl = Annotated[str, StringConstraints(max_length=SOURCE_URL_MAX_LENGTH)]

# Every ``SnapshotRejected`` code is a 400; the code says which check failed.
# Shared by every write form with a snapshot field.
ARCHIVE_ERROR_STATUS: dict[str, int] = {
    "original_url_not_on_event": 400,
    "snapshot_url_invalid": 400,
    "snapshot_url_too_long": 400,
    "snapshot_url_not_https": 400,
    "snapshot_provider_not_allowed": 400,
    "snapshot_not_a_replay_url": 400,
    "snapshot_not_a_snapshot_code": 400,
}


def raise_archive_error(exc: SnapshotRejected) -> NoReturn:
    """Translate a rejected snapshot paste into its 400."""
    raise_typed_error(exc, ARCHIVE_ERROR_STATUS)


_EVENT_ERROR_STATUS: dict[str, int] = {
    **EVIDENCE_INTAKE_ERROR_STATUS,
    "event_not_found": 404,
    "coordinates_required": 400,
    "invalid_coordinates": 400,
    "invalid_proof": 400,
    "proof_image_required": 400,
    "source_url_required": 400,
    "tag_requirements_not_met": 400,
    "too_many_source_links": 400,
    "invalid_state": 409,
    "nothing_changed": 409,
}


def _raise_event_error(exc: EvidenceIntakeError) -> NoReturn:
    """Translate a typed events-service error into an HTTP response."""
    raise_typed_error(exc, _EVENT_ERROR_STATUS)


_VERSION_ERROR_STATUS: dict[str, int] = {"version_limit": 409}


def raise_version_error(exc: VersionLimitError) -> NoReturn:
    """Translate a refused version into its 409.

    Its own map because :class:`VersionLimitError` is not an
    :class:`EvidenceIntakeError`, the base :func:`_raise_event_error` catches.
    """
    raise_typed_error(exc, _VERSION_ERROR_STATUS)


def resolve_live_event(db: Session, event_id: uuid.UUID) -> Event:
    """Fetch a live event by id, or 404.

    A soft-deleted or withheld (``hidden_at``) row reads as 404: a takedown
    freezes the event for its owner too, until the admin moderation endpoint
    lifts it. Permission is the caller's concern (geolocate owns per-status
    ownership; owner-only verbs call ``permissions.ensure_owner``).
    """
    geo = db.query(Event).filter(Event.id == event_id, *visible_events()).first()
    if geo is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return geo


def coords_or_none(lat: float | None, lng: float | None) -> CoordsRead | None:
    """Fold a projected ``(lat, lng)`` pair into the nested wire shape; a
    ``None`` on either side means no point."""
    if lat is None or lng is None:
        return None
    return CoordsRead(lat=lat, lng=lng)


def thumbnail_media(geo: Event) -> MediaRead | None:
    """The event's card thumbnail as its wire shape, or None
    (``services.thumbnails.pick_thumbnail`` owns the pick)."""
    row = pick_thumbnail(geo.media)
    return MediaRead.model_validate(row) if row is not None else None


def build_event_list(
    geo: Event,
    *,
    lat: float | None,
    lng: float | None,
) -> EventList:
    """Assemble the ``EventList`` card for one event.

    The list twin of :func:`build_event_read`; coordinates come in
    re-projected by the caller.
    """
    return EventList(
        id=geo.id,
        title=geo.title,
        event_coords=coords_or_none(lat, lng),
        event_date=geo.event_date,
        is_graphic=geo.is_graphic,
        status=geo.status,
        before_closed_status=geo.before_closed_status,
        owner=geo.owner,
        media=thumbnail_media(geo),
        tags=geo.tags,
        conflicts=geo.conflicts,
    )


def build_version_read(row: EventVersion) -> EventVersionRead:
    """Assemble one superseded version's wire shape.

    The snapshot travels as stored. A soft-deleted editor is dropped, as
    :func:`build_event_read` does for requesters and geolocators.
    """
    editor = row.edited_by
    return EventVersionRead(
        id=row.id,
        version_no=row.version_no,
        edited_by=editor if editor is not None and editor.deleted_at is None else None,
        note=row.note,
        created_at=row.created_at,
        snapshot=row.snapshot,
        redacted=row.redacted_at is not None,
    )


def _archived_link(geo: Event, url: str | None) -> ArchivedLinkRead | None:
    """One link's archived copy as wire shape, or ``None`` when it has none.

    The one place the stored row becomes wire shape, so every link serialises
    identically.
    """
    row = archive_row_for(geo, url)
    if row is None:
        return None
    return ArchivedLinkRead(url=row.snapshot_url, provider=row.provider)


def build_event_read(
    geo: Event,
    *,
    lat: float | None,
    lng: float | None,
    capture_lat: float | None = None,
    capture_lng: float | None = None,
) -> EventRead:
    """Assemble the ``EventRead`` response for one event.

    Coordinates are passed in (re-projected by the caller) so every response
    site builds an identical shape. Callers eager-load ``requested_by``,
    ``geolocators`` and their users. ``media`` carries only ``source`` rows
    (proof images travel inside the proof JSON). ``thumbnail`` may be a proof
    image on a source-less event; callers wanting it non-null there must
    eager-load media with ``thumbnail_media_criteria``.
    """
    return EventRead(
        id=geo.id,
        title=geo.title,
        event_coords=coords_or_none(lat, lng),
        capture_source_coords=coords_or_none(capture_lat, capture_lng),
        source_url=geo.source_url,
        # Reads the eager-loaded ``archives`` (see ``_DETAIL_LOADS``).
        archived_source=_archived_link(geo, geo.source_url),
        # Ordered by ``position``, the submitter's order.
        secondary_source_urls=[link.url for link in geo.source_links],
        # Same walk, so the lists stay index-aligned; no extra query.
        archived_secondary_sources=[_archived_link(geo, link.url) for link in geo.source_links],
        proof=geo.proof,
        event_date=geo.event_date,
        event_time=geo.event_time,
        source_posted_at=geo.source_posted_at,
        created_at=geo.created_at,
        geolocated_at=geo.geolocated_at,
        closed_at=geo.closed_at,
        is_graphic=geo.is_graphic,
        status=geo.status,
        version_no=geo.version_no,
        close_reason=geo.close_reason,
        before_closed_status=geo.before_closed_status,
        detected_from_url=geo.detected_from_url,
        detected_via=geo.detected_via,
        # Same eager-loaded collection, no extra query.
        archived_detected_from=_archived_link(geo, geo.detected_from_url),
        owner=geo.owner,
        # Null a soft-deleted requester: a banned account must not surface on a
        # live event owned by someone else (the owner's soft-delete hides their
        # events; the requester's does not).
        requested_by=(
            geo.requested_by
            if geo.requested_by is not None and geo.requested_by.deleted_at is None
            else None
        ),
        # Drop soft-deleted contributors for the same reason as ``requested_by``.
        geolocators=[g.user for g in geo.geolocators if g.user.deleted_at is None],
        media=[m for m in geo.media if m.role == "source"],
        thumbnail=thumbnail_media(geo),
        tags=geo.tags,
        conflicts=geo.conflicts,
    )
