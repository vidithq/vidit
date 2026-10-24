"""Shared helpers for the events sub-routers (``read`` / ``write`` / ``item``),
kept here so none imports another: the typed-error to HTTP envelopes, the
``EventRead`` / ``EventList`` assemblers (also imported by the users and social
routers), the projection helpers, :func:`resolve_live_event` and
:func:`resolve_readable_event`.
"""

import uuid
from typing import NoReturn

from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session, selectinload

from app.models.event import Event, EventVersion
from app.models.source import Source
from app.models.user import User
from app.routers._errors import raise_typed_error
from app.schemas.event import (
    EventList,
    EventRead,
    EventVersionRead,
)
from app.schemas.media import MediaRead
from app.schemas.source import (
    ArchivedLinkRead,
    CoordsRead,
    SourceCreate,
    SourceLinkRead,
    SourceRead,
)
from app.services.event_filters import visible_events
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError
from app.services.geolocator_credit import live_geolocators
from app.services.source_archive import SnapshotRejected, provider_of
from app.services.thumbnails import pick_thumbnail
from app.services.uploads import UPLOAD_ERROR_STATUS
from app.services.versions import VersionLimitError, point_shape

# Every ``SnapshotRejected`` code is a 400; the code says which check failed.
# Shared by every write form with a snapshot field.
ARCHIVE_ERROR_STATUS: dict[str, int] = {
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
    **UPLOAD_ERROR_STATUS,
    "event_not_found": 404,
    "coordinates_required": 400,
    "invalid_coordinates": 400,
    "invalid_proof": 400,
    "proof_image_required": 400,
    "conflict_required": 400,
    "source_required": 400,
    "source_file_required": 400,
    "source_link_required": 400,
    "invalid_source_url": 400,
    "sensor_required": 400,
    "too_many_sources": 400,
    "too_many_source_links": 400,
    "source_not_found": 400,
    "source_media_not_found": 400,
    "invalid_state": 409,
    "nothing_changed": 409,
}

# Every relationship ``build_source_read`` reads, for a query that serves sources.
SOURCE_LOAD = selectinload(Event.sources).options(
    selectinload(Source.links), selectinload(Source.tags), selectinload(Source.media)
)

_SOURCES_ADAPTER = TypeAdapter(list[SourceCreate])

# Help text of the ``sources`` form field, shared by every event write.
SOURCES_FIELD_DESCRIPTION = (
    "JSON array of SourceCreate: the event's whole source list, which replaces the stored one."
)


def parse_sources(raw: str | None) -> list[SourceCreate]:
    """The ``sources`` form field: a JSON array of ``SourceCreate``; absent is an empty list.

    A 422 names the failing entry, as a JSON body would.
    """
    if raw is None or not raw.strip():
        return []
    try:
        return _SOURCES_ADAPTER.validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=[
                {**error, "loc": ["body", "sources", *error["loc"]]}
                for error in exc.errors(include_url=False, include_context=False)
            ],
        ) from exc


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


def resolve_readable_event(
    db: Session, geolocation_id: uuid.UUID, current_user: User | None
) -> Event:
    """The event a history or approvals read may serve, or a 404.

    Same visibility as ``GET /{id}`` (soft-deleted hidden from all, withheld
    visible to admins), shared so those reads cannot diverge.
    """
    query = db.query(Event).filter(Event.id == geolocation_id, Event.deleted_at.is_(None))
    if current_user is None or not current_user.is_admin:
        query = query.filter(Event.hidden_at.is_(None))
    geo = query.first()
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
    row = pick_thumbnail(geo)
    return MediaRead.model_validate(row) if row is not None else None


def build_event_list(
    geo: Event,
    *,
    lat: float | None,
    lng: float | None,
) -> EventList:
    """Assemble the ``EventList`` card for one event.

    The list twin of :func:`build_event_read`; coordinates come in
    re-projected by the caller, which eager-loads ``geolocator_credit.CREDIT_LOAD``.
    """
    return EventList(
        id=geo.id,
        title=geo.title,
        coords=coords_or_none(lat, lng),
        occurred_date=geo.occurred_date,
        is_graphic=geo.is_graphic,
        status=geo.status,
        before_closed_status=geo.before_closed_status,
        requested_at=geo.requested_at,
        owner=geo.owner,
        geolocators=live_geolocators(geo),
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


def build_source_read(source: Source) -> SourceRead:
    """One source's wire shape; the caller loads its links, tags and media (``SOURCE_LOAD``)."""
    point = point_shape(source.camera_position)
    links: list[SourceLinkRead] = []
    for link in source.links:
        provider = provider_of(link.snapshot_url) if link.snapshot_url else None
        archived = (
            ArchivedLinkRead(url=link.snapshot_url, provider=provider, archived_at=link.archived_at)
            if link.snapshot_url and provider is not None and link.archived_at is not None
            else None
        )
        links.append(SourceLinkRead(url=link.url, posted_at=link.posted_at, archived=archived))
    return SourceRead(
        id=source.id,
        title=source.title,
        level=source.level,
        sensor=source.sensor,
        captured_at=source.captured_at,
        camera_position=CoordsRead(**point) if point is not None else None,
        is_graphic=source.is_graphic,
        links=links,
        tags=source.tags,
        media=source.media,
    )


def build_event_read(
    geo: Event,
    *,
    lat: float | None,
    lng: float | None,
) -> EventRead:
    """Assemble the ``EventRead`` response for one event.

    Coordinates are passed in (re-projected by the caller) so every response
    site builds an identical shape. Callers eager-load ``requested_by``,
    ``geolocators`` and their users, and the sources (``SOURCE_LOAD``).
    ``thumbnail`` may be a proof image on an event without a source file;
    callers wanting it there eager-load ``Event.media``.
    """
    return EventRead(
        id=geo.id,
        title=geo.title,
        coords=coords_or_none(lat, lng),
        sources=[build_source_read(source) for source in geo.sources],
        proof=geo.proof,
        occurred_date=geo.occurred_date,
        occurred_time=geo.occurred_time,
        created_at=geo.created_at,
        geolocated_at=geo.geolocated_at,
        closed_at=geo.closed_at,
        is_graphic=geo.is_graphic,
        status=geo.status,
        version_no=geo.version_no,
        close_reason=geo.close_reason,
        before_closed_status=geo.before_closed_status,
        detected_from_url=geo.detection.from_url if geo.detection is not None else None,
        detected_via=geo.detection.via if geo.detection is not None else None,
        owner=geo.owner,
        # Null a soft-deleted requester: a banned account must not surface on a
        # live event owned by someone else (the owner's soft-delete hides their
        # events; the requester's does not).
        requested_by=(
            geo.requested_by
            if geo.requested_by is not None and geo.requested_by.deleted_at is None
            else None
        ),
        geolocators=live_geolocators(geo),
        thumbnail=thumbnail_media(geo),
        tags=geo.tags,
        conflicts=geo.conflicts,
    )
