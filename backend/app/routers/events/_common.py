"""Helpers the events sub-routers share, kept here so none imports another."""

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import File, Form, HTTPException, UploadFile
from pydantic import Field, TypeAdapter, ValidationError
from sqlalchemy import ColumnElement
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.event import Event, EventVersion
from app.models.source import Source
from app.models.user import User
from app.routers._forms import (
    parse_json_id_list,
    parse_optional_iso_date,
    parse_optional_iso_time,
)
from app.schemas.event import (
    EventList,
    EventRead,
    EventVersionRead,
    GeolocatorInviteCreate,
)
from app.schemas.source import SourceCreate
from app.services.event_filters import visible_events
from app.services.events.form import EventForm
from app.services.events.sources import build_source_read
from app.services.geolocator_credit import (
    CREDIT_LOAD,
    MAX_EVENT_GEOLOCATORS,
    live_geolocators,
)
from app.services.thumbnails import thumbnail_loads, thumbnail_media
from app.services.versions import point_shape

# Every relationship ``build_source_read`` reads, for a query that serves sources.
SOURCE_LOAD = selectinload(Event.sources).options(
    selectinload(Source.links), selectinload(Source.tags), selectinload(Source.media)
)

# Every relationship ``build_event_read`` reads: the event page and the detection queue. A
# paged query may take it, since ``joinedload`` covers the many-to-one owner and requested_by
# only and every set is a ``selectinload``, which never row-multiplies against ``LIMIT``.
DETAIL_LOADS = (
    joinedload(Event.owner),
    joinedload(Event.requested_by),
    *thumbnail_loads(),
    selectinload(Event.tags),
    selectinload(Event.conflicts),
    CREDIT_LOAD,
    SOURCE_LOAD,
    selectinload(Event.detection),
)

_SOURCES_ADAPTER = TypeAdapter(list[SourceCreate])

# Past the cap every list fails ``too_many_geolocators``; the bound keeps the parse small.
_INVITES_ADAPTER: TypeAdapter[list[GeolocatorInviteCreate]] = TypeAdapter(
    Annotated[list[GeolocatorInviteCreate], Field(max_length=MAX_EVENT_GEOLOCATORS)]
)

GEOLOCATOR_INVITES_FIELD_DESCRIPTION = (
    "JSON array of GeolocatorInviteCreate: the analysts invited to share the credit once the "
    "event is published, in the same transaction."
)

SOURCES_FIELD_DESCRIPTION = (
    "JSON array of SourceCreate: the event's whole source list, which replaces the stored one."
)


def _parse_json_field[T](adapter: TypeAdapter[list[T]], raw: str | None, *, field: str) -> list[T]:
    """A JSON-array form field; absent is an empty list. A 422 names the failing entry, as a
    JSON body would."""
    if raw is None or not raw.strip():
        return []
    try:
        return adapter.validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=[
                {**error, "loc": ["body", field, *error["loc"]]}
                for error in exc.errors(include_url=False, include_context=False)
            ],
        ) from exc


def parse_sources(raw: str | None) -> list[SourceCreate]:
    return _parse_json_field(_SOURCES_ADAPTER, raw, field="sources")


def parse_geolocator_invites(raw: str | None) -> list[str]:
    """The ``geolocator_invites`` form field: the usernames of a JSON array of
    ``GeolocatorInviteCreate``."""
    invites = _parse_json_field(_INVITES_ADAPTER, raw, field="geolocator_invites")
    return [invite.username for invite in invites]


@dataclass(frozen=True)
class EventFormFields:
    """The multipart fields every event write posts but the title, as sent; a dependency of the
    four writes.

    Each write declares its own ``title`` field and its own title rule. Parsed in the handler
    (:meth:`parse`), not here, so the rate limit counts a malformed form.
    """

    # No ``max_length``: ``date.fromisoformat`` is the source of truth (a cap of 10 would
    # reject ``2026-05-01T00:00:00`` with a generic 422).
    occurred_date: str | None = Form(None)
    occurred_time: str | None = Form(None)
    proof: str | None = Form(None)
    tag_ids: str | None = Form(None)
    conflict_ids: str | None = Form(None)
    sources: str = Form(..., description=SOURCES_FIELD_DESCRIPTION)
    # Matched to the proof's ``placeholder://`` srcs.
    proof_files: list[UploadFile] | None = File(None)

    def parse(self, title: str, *, reject_blank_title: bool = False) -> EventForm:
        parsed_sources = parse_sources(self.sources)
        if reject_blank_title and not title.strip():
            raise HTTPException(status_code=400, detail="title is required")
        return EventForm(
            title=title,
            proof_data=self.proof or None,
            tag_ids=parse_json_id_list(self.tag_ids, field="tag_ids"),
            conflict_ids=parse_json_id_list(self.conflict_ids, field="conflict_ids"),
            # Form(str) does not validate the shape; a raw value would 500 at flush.
            occurred_date=parse_optional_iso_date(self.occurred_date, field="occurred_date"),
            occurred_time=parse_optional_iso_time(self.occurred_time, field="occurred_time"),
            sources=parsed_sources,
            proof_files=self.proof_files or [],
        )


def _or_404(geo: Event | None) -> Event:
    if geo is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return geo


def readable_events(current_user: User | None) -> tuple[ColumnElement[bool], ...]:
    """The rows ``GET /{id}`` serves: a withheld (``hidden_at``) row only to an admin, who must
    read what was taken down to judge the report."""
    if current_user is not None and current_user.is_admin:
        return (Event.deleted_at.is_(None),)
    return visible_events()


def resolve_live_event(db: Session, event_id: uuid.UUID) -> Event:
    """Fetch a live event by id, or 404.

    A withheld row reads as 404: a takedown freezes the event for its owner too, until the
    admin moderation endpoint lifts it. Resolved in the handler, not as a dependency, so the
    rate limit counts a request for an unknown id.
    """
    return _or_404(db.query(Event).filter(Event.id == event_id, *visible_events()).first())


def resolve_readable_event(
    db: Session, geolocation_id: uuid.UUID, current_user: User | None
) -> Event:
    """The event a history or approvals read may serve, with the visibility of ``GET /{id}``."""
    return _or_404(
        db.query(Event).filter(Event.id == geolocation_id, *readable_events(current_user)).first()
    )


def _card_fields(geo: Event) -> dict[str, Any]:
    """The fields ``EventRead`` and ``EventList`` share."""
    return {
        "id": geo.id,
        "title": geo.title,
        "coords": point_shape(geo.coords),
        "occurred_date": geo.occurred_date,
        "is_graphic": geo.is_graphic,
        "status": geo.status,
        "before_closed_status": geo.before_closed_status,
        "owner": geo.owner,
        "geolocators": live_geolocators(geo),
        "tags": geo.tags,
        "conflicts": geo.conflicts,
    }


def build_event_list(geo: Event) -> EventList:
    """The caller eager-loads ``CREDIT_LOAD``."""
    return EventList(**_card_fields(geo), requested_at=geo.requested_at, media=thumbnail_media(geo))


def build_version_read(row: EventVersion) -> EventVersionRead:
    """A soft-deleted editor is dropped, as :func:`build_event_read` does for requesters and
    geolocators."""
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


def build_event_read(geo: Event) -> EventRead:
    """Callers eager-load ``requested_by``,
    ``geolocators`` and their users, and the sources (``SOURCE_LOAD``).
    ``thumbnail`` may be a proof image on an event without a source file;
    callers wanting it there eager-load ``Event.media``.
    """
    return EventRead(
        **_card_fields(geo),
        sources=[build_source_read(source) for source in geo.sources],
        proof=geo.proof,
        occurred_time=geo.occurred_time,
        created_at=geo.created_at,
        geolocated_at=geo.geolocated_at,
        closed_at=geo.closed_at,
        hidden_at=geo.hidden_at,
        version_no=geo.version_no,
        close_reason=geo.close_reason,
        detected_from_url=geo.detection.from_url if geo.detection is not None else None,
        detected_via=geo.detection.via if geo.detection is not None else None,
        # Null a soft-deleted requester: a banned account must not surface on a
        # live event owned by someone else (the owner's soft-delete hides their
        # events; the requester's does not).
        requested_by=(
            geo.requested_by
            if geo.requested_by is not None and geo.requested_by.deleted_at is None
            else None
        ),
        thumbnail=thumbnail_media(geo),
    )
