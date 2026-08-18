"""Single-event ops by id: detail, delete, and the lifecycle verbs
(geolocate, close)."""

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.orm import Session, joinedload, selectinload

from app.cache import points_cache
from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.content_report import ContentReport
from app.models.event import (
    SOURCE_URL_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    Event,
    EventGeolocator,
)
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers._forms import (
    parse_iso_datetime,
    parse_json_id_list,
    parse_optional_iso_date,
    parse_optional_iso_time,
    parse_optional_json_object,
)
from app.routers.events._common import (
    SecondarySourceUrl,
    _raise_event_error,
    build_event_read,
    raise_archive_error,
    resolve_live_event,
)
from app.schemas.event import EventCloseRequest, EventRead
from app.schemas.report import ContentReportCreate, ContentReportRead
from app.services import events as events_service
from app.services import permissions
from app.services import reports as reports_service
from app.services.evidence_intake import EvidenceIntakeError, collect_media_keys
from app.services.source_archive import SnapshotRejected
from app.services.storage import (
    sweep_keys,
)
from app.services.thumbnails import thumbnail_media_criteria

router = APIRouter()

# Every relationship the detail serializer reads, eager-loaded so one event
# costs a bounded set of queries (no per-contributor lazy hits).
_DETAIL_LOADS = (
    joinedload(Event.owner),
    joinedload(Event.requested_by),
    selectinload(Event.media.and_(thumbnail_media_criteria())),
    selectinload(Event.tags),
    selectinload(Event.conflicts),
    selectinload(Event.geolocators).joinedload(EventGeolocator.user),
    # The archived-source fallback in ``build_event_read`` reads this set; a
    # detail loader without it pays a lazy query per event.
    selectinload(Event.archives),
    selectinload(Event.source_links),
)


def _serialize_event(db: Session, geo: Event) -> EventRead:
    """Build the read model for a just-mutated row.

    Re-projects both points out of PostGIS with the same ``ST_Y`` / ``ST_X``
    cast ``GET /{id}`` uses, so a mutation returns a response identical in
    shape to a fresh read.
    """
    lat, lng, capture_lat, capture_lng = (
        db.query(
            ST_Y(Event.event_coords),
            ST_X(Event.event_coords),
            ST_Y(Event.capture_source_coords),
            ST_X(Event.capture_source_coords),
        )
        .filter(Event.id == geo.id)
        .one()
    )
    return build_event_read(geo, lat=lat, lng=lng, capture_lat=capture_lat, capture_lng=capture_lng)


# Defined ahead of the ``/{geolocation_id}`` reads below: the extra path
# segment means the catch-all cannot shadow it, and keeping the public write
# next to them states the order the router matches in.
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
    """Report an event for moderation.

    Open to anonymous viewers: the people a piece of footage harms rarely hold
    an account here, so requiring one would close the door on the reports that
    matter most. A signed-in reporter is recorded on the row; an anonymous one
    leaves ``reporter_user_id`` NULL. The per-IP limit is the abuse floor.

    An unknown, soft-deleted or already-withheld event answers 404: all three
    are invisible to the caller, so all three read the same.
    """
    try:
        return reports_service.create_report(
            db,
            event_id=geolocation_id,
            reason=body.reason,
            details=body.details,
            reporter_user_id=current_user.id if current_user is not None else None,
            reporter_username=current_user.username if current_user is not None else None,
            background_tasks=background_tasks,
        )
    except reports_service.ReportError as exc:
        raise_typed_error(exc, reports_service.REPORT_ERROR_STATUS)


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

    A withheld event (``hidden_at``) answers 404 for everyone but an admin, who
    still needs to read what was taken down in order to judge the report that
    took it down.
    """
    query = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
            ST_Y(Event.capture_source_coords).label("capture_lat"),
            ST_X(Event.capture_source_coords).label("capture_lng"),
        )
        .options(*_DETAIL_LOADS)
        .filter(Event.id == geolocation_id, Event.deleted_at.is_(None))
    )
    if current_user is None or not current_user.is_admin:
        query = query.filter(Event.hidden_at.is_(None))
    row = query.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")

    geo, lat, lng, capture_lat, capture_lng = row
    return build_event_read(geo, lat=lat, lng=lng, capture_lat=capture_lat, capture_lng=capture_lng)


@router.delete("/{geolocation_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_event(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hard-delete by the owner. Cascades drop the tag links, contributor
    rows and media rows; the S3 objects (media of every role, plus the source
    image derivatives) are swept after the commit lands. Admin soft-delete
    lives behind the admin router and stamps ``deleted_at`` instead.
    """
    geo = resolve_live_event(db, geolocation_id)
    permissions.ensure_owner(geo, current_user)

    # Snapshot the S3 keys before the cascade drops the rows, then
    # commit-then-sweep (see ``services.storage.sweep_keys``).
    media_keys = collect_media_keys(list(geo.media))

    db.delete(geo)
    db.commit()

    sweep_keys(media_keys, context=f"event {geo.id} delete")

    points_cache.invalidate()


# ── Lifecycle verbs ───────────────────────────────────────────────────
# Geolocate writes the caller's edits and moves a ``requested`` or
# ``detected`` event to ``geolocated``; close is the terminal withdraw /
# reject. A detection is owner-only; a ``requested`` event is
# answerable by anyone (the fulfiller becomes the owner). A ``geolocated``
# row is frozen (409). See ``api.md``.


@router.post("/{geolocation_id}/geolocate", response_model=EventRead)
@limiter.limit("30/minute")
async def geolocate_event(
    request: Request,
    geolocation_id: uuid.UUID,
    # Multipart, mirroring create: the form posts the whole state and the service
    # writes it and flips to ``geolocated`` atomically. ``max_length`` ceilings are
    # the shared model constants (same as create) so over-length input is rejected
    # before the files hit S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    # The archived copy of the stored source URL, if the analyst made one while
    # editing (same field the submit form carries). Optional; checked against
    # the source URL this write stores.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # The mirrors, repeated once per link. The submitted list REPLACES whatever
    # the row held, on a requested fulfilment too: unlike ``source_url`` these
    # carry no requester protection (see the service docstring).
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    # Optional, mirroring create: the footage doesn't always establish when the
    # depicted event happened; NULL reads as "Unknown".
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    source_posted_at: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    # The author's graphic-content declaration. Unlike the fields around it
    # this one ratchets: omitting it leaves a flag the event already carries,
    # and only the admin moderation endpoint can clear one.
    is_graphic: bool = Form(False),
    # Ids of existing media to drop (JSON array). A replacement source rides
    # in ``files``; the proof body's new inline images in ``proof_files``.
    remove_media_ids: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Give an event a vouched location: ``requested`` | ``detected`` → ``geolocated``.

    The one generalized fulfil / submit transition. The caller posts the whole
    form (title, coordinates, source URL, dates, the graphic-content flag,
    proof + its images, tags, and the source media: ``files`` added,
    ``remove_media_ids`` dropped), and on
    success the row is written and frozen as ``geolocated``, with the caller
    credited as a geolocator. Only ``detected_from_url`` (provenance) and
    ``status`` carry no field. A detection is owner-only (403
    otherwise); a ``requested`` event is answerable by anyone, and the
    fulfiller becomes its owner (``requested_by`` keeps the original poster).
    Blocked until the evidence floor is met (one source media, a proof image,
    a conflict, and the ``capture_source`` tag, 400 otherwise). Off
    ``requested`` / ``detected`` → 409. Soft-deleted rows read as 404.

    ``source_snapshot_url`` records the archived source in the same write, on
    the terms ``POST /events/{id}/archives`` applies (a paste that is not a
    snapshot of the stored source URL is a 400, and nothing is written). An
    edit that changes the source URL and pastes no new snapshot leaves the
    event with no archived source rather than the old one's copy.
    """
    files = files or []
    proof_files = proof_files or []
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")
    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids", as_uuid=True)
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids", as_uuid=True)
    parsed_remove_ids = parse_json_id_list(remove_media_ids, field="remove_media_ids")

    # Not owner-gated at the router: the service enforces per-status ownership
    # (owner-only for ``detected``, open for ``requested``) under a row lock.
    geo = resolve_live_event(db, geolocation_id)
    try:
        geolocated = await events_service.geolocate(
            db,
            geo=geo,
            current_user=current_user,
            title=title,
            lat=lat,
            lng=lng,
            capture_source_lat=capture_source_lat,
            capture_source_lng=capture_source_lng,
            source_url=source_url,
            source_snapshot_url=source_snapshot_url,
            secondary_source_urls=secondary_source_urls,
            event_date=parsed_event_date,
            event_time=parsed_event_time,
            source_posted_at=parsed_source_posted_at,
            proof_data=proof_data,
            tag_ids=parsed_tag_ids,
            conflict_ids=parsed_conflict_ids,
            is_graphic=is_graphic,
            remove_media_ids=parsed_remove_ids,
            files=files,
            proof_files=proof_files,
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)
    return _serialize_event(db, geolocated)


@router.post("/{geolocation_id}/close", response_model=EventRead)
@limiter.limit("60/minute")
def close_event(
    request: Request,
    geolocation_id: uuid.UUID,
    body: EventCloseRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Close an event: withdraw a request or reject a detection (owner-only).

    One terminal verb for both dismissal shapes; ``before_closed_status``
    records which state the row left, and the required ``close_reason`` stays
    publicly visible. The row remains readable (transparency), drops off the
    map, and a closed detection is re-importable. Off ``requested`` /
    ``detected`` → 409; soft-deleted → 404; not the owner → 403.
    """
    geo = resolve_live_event(db, geolocation_id)
    try:
        closed = events_service.close(
            db, geo=geo, current_user=current_user, close_reason=body.close_reason
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    return _serialize_event(db, closed)
