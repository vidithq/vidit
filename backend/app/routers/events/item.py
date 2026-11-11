"""Single-event routes by id."""

import asyncio
import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy.orm import Session

from app.dependencies import (
    DB,
    CurrentUser,
    Cursor,
    OptionalUser,
)
from app.models.content_report import ContentReport
from app.models.event import TITLE_MAX_LENGTH, Event, EventVersion
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import (
    DETAIL_LOADS,
    GEOLOCATOR_INVITES_FIELD_DESCRIPTION,
    EventFormFields,
    build_event_read,
    build_version_read,
    parse_geolocator_invites,
    readable_events,
    resolve_live_event,
    resolve_readable_event,
)
from app.schemas.collection import CollectionMembershipList
from app.schemas.event import (
    VERSION_NOTE_MAX_LENGTH,
    EventCloseRequest,
    EventRead,
    EventVersionList,
    EventVersionRead,
)
from app.schemas.report import ContentReportCreate, ContentReportRead
from app.services import collections as collections_service
from app.services import events as events_service
from app.services import reports as reports_service
from app.services import versions as versions_service
from app.services.geolocator_credit import has_pending_invite
from app.services.pagination import (
    decode_ordinal_cursor,
    encode_ordinal_cursor,
    page_size,
    paged,
)

router = APIRouter()


def _serialize_event(db: Session, geo: Event) -> EventRead:
    read = build_event_read(geo)
    read.version_zero = versions_service.version_zero(db, geo)
    return read


# Ahead of the ``/{geolocation_id}`` reads: the extra path segment means the
# catch-all cannot shadow it.
@router.post(
    "/{geolocation_id}/report",
    response_model=ContentReportRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/hour")
def report_event(
    request: Request,
    geolocation_id: uuid.UUID,
    body: ContentReportCreate,
    background_tasks: BackgroundTasks,
    current_user: OptionalUser,
    db: DB,
) -> ContentReport:
    """Report an event for moderation."""
    return reports_service.create_report(
        db,
        kind="event",
        target_id=geolocation_id,
        body=body,
        reporter=current_user,
        background_tasks=background_tasks,
    )


@router.get("/{geolocation_id}", response_model=EventRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_event(request: Request, geolocation_id: uuid.UUID, db: DB, current_user: OptionalUser):
    """The detail read.

    A withheld event (``hidden_at``) answers 404 for everyone but an admin,
    who must read what was taken down to judge the report.
    """
    geo = (
        db.query(Event)
        .options(*DETAIL_LOADS)
        .filter(Event.id == geolocation_id, *readable_events(current_user))
        .first()
    )
    if geo is None:
        raise HTTPException(status_code=404, detail="Event not found")
    read = _serialize_event(db, geo)
    if current_user is not None:
        read.viewer_invite_pending = has_pending_invite(
            db, event_id=geo.id, user_id=current_user.id
        )
    return read


# The two multipart writes are plain ``def`` driving their async service
# through ``asyncio.run``, so their queries and the row lock held across the
# upload stay off the event loop (``engineering.md``, Request concurrency).


@router.post("/{geolocation_id}/request", response_model=EventRead)
@limiter.limit("30/minute")
def update_event_request(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    # The approximate guess a request may carry: both halves or neither.
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    fields: EventFormFields = Depends(),
):
    """Correct an open request, overwriting it in place (owner-only)."""
    form = fields.parse(title, reject_blank_title=True)
    # The service re-checks ownership and status under the row lock (race-free).
    geo = resolve_live_event(db, geolocation_id)
    edited = asyncio.run(
        events_service.update_request(
            db, geo=geo, current_user=current_user, form=form, lat=lat, lng=lng
        )
    )
    return _serialize_event(db, edited)


@router.post("/{geolocation_id}/versions", response_model=EventRead)
@limiter.limit("30/minute")
def save_event_version(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    # The editor's note, stored on the version this edit supersedes.
    note: str | None = Form(None, max_length=VERSION_NOTE_MAX_LENGTH),
    version_no: int | None = Form(
        None,
        ge=0,
        description="The version the form was loaded at; a row that moved past it answers 409.",
    ),
    geolocator_invites: str | None = Form(None, description=GEOLOCATOR_INVITES_FIELD_DESCRIPTION),
    fields: EventFormFields = Depends(),
):
    """Publish a request or a detection, or correct a published event, filing a version."""
    form = fields.parse(title)
    invites = parse_geolocator_invites(geolocator_invites)
    # The service re-checks ownership and status under the row lock (race-free).
    geo = resolve_live_event(db, geolocation_id)
    edited = asyncio.run(
        events_service.save_version(
            db,
            geo=geo,
            current_user=current_user,
            form=form,
            lat=lat,
            lng=lng,
            note=note,
            expected_version=version_no,
            geolocator_invites=invites,
        )
    )
    return _serialize_event(db, edited)


@router.get("/{geolocation_id}/versions", response_model=EventVersionList)
@authenticated_read_quota
@limiter.limit("120/minute")
def list_event_versions(
    request: Request,
    response: Response,
    geolocation_id: uuid.UUID,
    db: DB,
    current_user: OptionalUser,
    limit: int = Query(versions_service.HISTORY_PAGE_SIZE, ge=1),
    cursor: Cursor = None,
):
    """The event's superseded versions, newest first."""
    geo = resolve_readable_event(db, geolocation_id, current_user)

    size = page_size(limit)
    window = versions_service.list_versions(
        db,
        EventVersion,
        geo.id,
        limit=size,
        cursor=decode_ordinal_cursor(cursor) if cursor is not None else None,
    )
    rows = paged(request, response, window, size, lambda r: encode_ordinal_cursor(r.version_no))
    return EventVersionList(
        items=[build_version_read(row) for row in rows],
        total=versions_service.count_versions(db, EventVersion, geo.id),
    )


@router.get("/{geolocation_id}/versions/{version_no}", response_model=EventVersionRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_event_version(
    request: Request, geolocation_id: uuid.UUID, version_no: int, db: DB, current_user: OptionalUser
):
    """One superseded version of an event, by its number."""
    geo = resolve_readable_event(db, geolocation_id, current_user)
    row = versions_service.get_version(db, EventVersion, geo.id, version_no)
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return build_version_read(row)


@router.get("/{geolocation_id}/collections", response_model=CollectionMembershipList)
@limiter.limit("120/minute")
def list_event_collections(
    request: Request, geolocation_id: uuid.UUID, current_user: CurrentUser, db: DB
):
    """Your collections, each saying whether this event is already on it."""
    geo = resolve_live_event(db, geolocation_id)
    collections_service.ensure_credited(db, event_id=geo.id, user=current_user)
    return CollectionMembershipList(
        items=collections_service.list_memberships(db, owner=current_user, event_id=geo.id)
    )


@router.post("/{geolocation_id}/close", response_model=EventRead)
@limiter.limit("60/minute")
def close_event(
    request: Request,
    geolocation_id: uuid.UUID,
    body: EventCloseRequest,
    current_user: CurrentUser,
    db: DB,
):
    """Close an event: withdraw, reject or retract it (owner-only)."""
    geo = resolve_live_event(db, geolocation_id)
    closed = events_service.close(
        db, geo=geo, current_user=current_user, close_reason=body.close_reason
    )
    return _serialize_event(db, closed)
