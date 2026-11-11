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
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.content_report import ContentReport
from app.models.event import TITLE_MAX_LENGTH, Event
from app.models.user import User
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


def _detail_read(db: Session, geo: Event, lat: float | None, lng: float | None) -> EventRead:
    read = build_event_read(geo, lat=lat, lng=lng)
    read.version_zero = versions_service.version_zero(db, geo)
    return read


def _serialize_event(db: Session, geo: Event) -> EventRead:
    """The read of a just-written row, its point re-projected as ``GET /{id}`` does."""
    lat, lng = db.query(ST_Y(Event.coords), ST_X(Event.coords)).filter(Event.id == geo.id).one()
    return _detail_read(db, geo, lat, lng)


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
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> ContentReport:
    """Report an event for moderation."""
    return reports_service.create_event_report(
        db,
        event_id=geolocation_id,
        reason=body.reason,
        details=body.details,
        reporter_id=current_user.id if current_user is not None else None,
        reporter_username=current_user.username if current_user is not None else None,
        background_tasks=background_tasks,
    )


@router.get("/{geolocation_id}", response_model=EventRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_event(
    request: Request,
    geolocation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """The detail read.

    A withheld event (``hidden_at``) answers 404 for everyone but an admin,
    who must read what was taken down to judge the report.
    """
    row = (
        db.query(Event, ST_Y(Event.coords), ST_X(Event.coords))
        .options(*DETAIL_LOADS)
        .filter(Event.id == geolocation_id, *readable_events(current_user))
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")
    geo, lat, lng = row
    read = _detail_read(db, geo, lat, lng)
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
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    # The approximate guess a request may carry: both halves or neither.
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    limit: int = Query(versions_service.HISTORY_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """The event's superseded versions, newest first."""
    geo = resolve_readable_event(db, geolocation_id, current_user)

    size = page_size(limit)
    window = versions_service.list_versions(
        db,
        geo.id,
        limit=size,
        cursor=decode_ordinal_cursor(cursor) if cursor is not None else None,
    )
    rows = paged(request, response, window, size, lambda r: encode_ordinal_cursor(r.version_no))
    return EventVersionList(
        items=[build_version_read(row) for row in rows],
        total=versions_service.count_versions(db, geo.id),
    )


@router.get("/{geolocation_id}/versions/{version_no}", response_model=EventVersionRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_event_version(
    request: Request,
    geolocation_id: uuid.UUID,
    version_no: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """One superseded version of an event, by its number."""
    geo = resolve_readable_event(db, geolocation_id, current_user)
    row = versions_service.get_version(db, event_id=geo.id, version_no=version_no)
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return build_version_read(row)


@router.get("/{geolocation_id}/collections", response_model=CollectionMembershipList)
@limiter.limit("120/minute")
def list_event_collections(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Close an event: withdraw, reject or retract it (owner-only)."""
    geo = resolve_live_event(db, geolocation_id)
    closed = events_service.close(
        db, geo=geo, current_user=current_user, close_reason=body.close_reason
    )
    return _serialize_event(db, closed)
