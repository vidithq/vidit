"""Single-event ops by id: detail, the versioned write that publishes or corrects an
event (save_version + version history), the open-request correction (update_request) and
close.

No delete: an owner takes a row back with ``close``; destruction is
``DELETE /admin/events/{id}``.
"""

import asyncio
import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.orm import Session, joinedload, selectinload

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.content_report import ContentReport
from app.models.event import TITLE_MAX_LENGTH, Event
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers._forms import (
    parse_json_id_list,
    parse_optional_iso_date,
    parse_optional_iso_time,
)
from app.routers.events._common import (
    GEOLOCATOR_INVITES_FIELD_DESCRIPTION,
    SOURCE_LOAD,
    SOURCES_FIELD_DESCRIPTION,
    _raise_event_error,
    build_event_read,
    build_version_read,
    parse_geolocator_invites,
    parse_sources,
    raise_archive_error,
    raise_credit_error,
    raise_version_error,
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
from app.services.evidence_intake import EvidenceIntakeError
from app.services.geolocator_credit import CREDIT_LOAD, GeolocatorCreditError, has_pending_invite
from app.services.pagination import (
    decode_ordinal_cursor,
    encode_ordinal_cursor,
    page_size,
    paged,
)
from app.services.source_archive import SnapshotRejected
from app.services.thumbnails import thumbnail_loads

router = APIRouter()

# Every relationship the detail serializer reads, eager-loaded to bound queries.
_DETAIL_LOADS = (
    joinedload(Event.owner),
    joinedload(Event.requested_by),
    *thumbnail_loads(),
    selectinload(Event.tags),
    selectinload(Event.conflicts),
    CREDIT_LOAD,
    # ``build_event_read`` reads these; without them, a lazy query per event.
    SOURCE_LOAD,
    selectinload(Event.detection),
)


def _serialize_event(db: Session, geo: Event) -> EventRead:
    """Build the read model for a just-mutated row, re-projecting the point
    the way ``GET /{id}`` does so the shapes match."""
    lat, lng = db.query(ST_Y(Event.coords), ST_X(Event.coords)).filter(Event.id == geo.id).one()
    read = build_event_read(geo, lat=lat, lng=lng)
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
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> ContentReport:
    """Report an event for moderation.

    Open to anonymous viewers: the people footage harms rarely hold an account
    here. A signed-in reporter is recorded; an anonymous one leaves
    ``reporter_id`` NULL. The per-IP limit is the abuse floor.

    An unknown, soft-deleted or already-withheld event answers 404.
    """
    try:
        return reports_service.create_event_report(
            db,
            event_id=geolocation_id,
            reason=body.reason,
            details=body.details,
            reporter_id=current_user.id if current_user is not None else None,
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

    A withheld event (``hidden_at``) answers 404 for everyone but an admin,
    who must read what was taken down to judge the report.
    """
    query = (
        db.query(
            Event,
            ST_Y(Event.coords).label("lat"),
            ST_X(Event.coords).label("lng"),
        )
        .options(*_DETAIL_LOADS)
        .filter(Event.id == geolocation_id, Event.deleted_at.is_(None))
    )
    if current_user is None or not current_user.is_admin:
        query = query.filter(Event.hidden_at.is_(None))
    row = query.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")

    geo, lat, lng = row
    read = build_event_read(geo, lat=lat, lng=lng)
    read.version_zero = versions_service.version_zero(db, geo)
    if current_user is not None:
        read.viewer_invite_pending = has_pending_invite(
            db, event_id=geo.id, user_id=current_user.id
        )
    return read


# ── Lifecycle verbs ───────────────────────────────────────────────────
# ``save_version`` is the one write that files a version: it publishes a
# ``requested`` or ``detected`` event (version 0 becomes version 1) and corrects
# a ``geolocated`` one. A detection and a published row are owner-only; a
# request is answerable by anyone (the fulfiller becomes the owner). The
# requester corrects an open request in place through ``update_request``
# (owner-only, it stays version 0). Close is the terminal withdraw / reject /
# retract, in every live state. An owner's way out of a published claim is the
# retraction; destruction is admin-only. See ``api.md``.
#
# The two multipart writes are plain ``def`` driving their async service
# through ``asyncio.run``, so their queries and the row lock held across the
# upload stay off the event loop (``engineering.md``, Request concurrency).


@router.post("/{geolocation_id}/request", response_model=EventRead)
@limiter.limit("30/minute")
def update_event_request(
    request: Request,
    geolocation_id: uuid.UUID,
    # Multipart like ``POST /events/requests``: same fields and ceilings.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    proof: str | None = Form(None),
    # The approximate guess a request may carry: both halves or neither.
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    occurred_date: str | None = Form(None),
    occurred_time: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    sources: str = Form(..., description=SOURCES_FIELD_DESCRIPTION),
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Correct an open request, overwriting it in place (owner-only).

    No version is filed: the request stays version 0 until it is published
    through ``POST /events/{id}/versions``. The row keeps its id,
    ``requested_at``, requester and provenance, and moves ``updated_at``.
    Allowed only while ``requested`` (409 otherwise).

    Every create-form field is editable, the coordinate guess included; the
    publication floor stays unenforced until the publish, but the row must still
    hold a direct or indirect source with its file. Soft-deleted rows read as 404.
    """
    parsed_sources = parse_sources(sources)
    proof_files = proof_files or []
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")

    proof_data = proof or None
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids")
    parsed_occurred_date = parse_optional_iso_date(occurred_date, field="occurred_date")
    parsed_occurred_time = parse_optional_iso_time(occurred_time, field="occurred_time")

    # The service re-checks ownership and status under the row lock (race-free).
    geo = resolve_live_event(db, geolocation_id)
    try:
        edited = asyncio.run(
            events_service.update_request(
                db,
                geo=geo,
                current_user=current_user,
                title=title,
                proof_data=proof_data,
                lat=lat,
                lng=lng,
                occurred_date=parsed_occurred_date,
                occurred_time=parsed_occurred_time,
                tag_ids=parsed_tag_ids,
                conflict_ids=parsed_conflict_ids,
                sources=parsed_sources,
                proof_files=proof_files,
            )
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)
    return _serialize_event(db, edited)


@router.post("/{geolocation_id}/versions", response_model=EventRead)
@limiter.limit("30/minute")
def save_event_version(
    request: Request,
    geolocation_id: uuid.UUID,
    # Multipart like create: the service writes the editable state and the
    # superseded version atomically. ``max_length`` uses the shared model
    # constant so over-length input is rejected before any work.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    occurred_date: str | None = Form(None),
    occurred_time: str | None = Form(None),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    sources: str = Form(..., description=SOURCES_FIELD_DESCRIPTION),
    # The editor's note, stored on the version this edit supersedes.
    note: str | None = Form(None, max_length=VERSION_NOTE_MAX_LENGTH),
    version_no: int | None = Form(
        None,
        ge=0,
        description="The version the form was loaded at; a row that moved past it answers 409.",
    ),
    geolocator_invites: str | None = Form(None, description=GEOLOCATOR_INVITES_FIELD_DESCRIPTION),
    # New inline proof images, matched to ``placeholder://`` srcs.
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Publish a request or a detection, or correct a published event, filing a version.

    The caller posts the whole form (title, coordinates, dates, proof + images, tags,
    conflicts, sources). The pre-edit state is filed as an ``event_versions`` row and the
    event moves to the next ``version_no``, in one transaction under a row lock.

    On a ``requested`` or ``detected`` event (version 0) this publishes: the event becomes
    ``geolocated`` at version 1 and the caller is credited as a geolocator. A detection is
    owner-only (403 otherwise); a request is answerable by anyone, and the fulfiller becomes
    its owner (``requested_by`` keeps the poster). A publish invites each analyst in
    ``geolocator_invites`` to share the credit, refused as
    ``POST /events/{id}/geolocator-invites`` refuses, and a refusal publishes nothing; a
    ``geolocated`` event takes none (409). On a ``geolocated`` event it is an
    owner-only correction, refused when nothing changed. Other statuses 409, and 409
    ``version_mismatch`` when ``version_no`` names a version the event has moved past.

    The sources are versioned too: the posted list replaces the stored one and the filed
    version keeps what it supersedes, files included. The publication floor (coordinates, a
    direct or indirect source with its file, a proof image, a conflict) is checked on the
    post-edit state. A save whose only change is a link's archived copy is accepted even at
    the version ceiling. Soft-deleted rows read as 404.
    """
    parsed_sources = parse_sources(sources)
    parsed_invites = parse_geolocator_invites(geolocator_invites)
    proof_files = proof_files or []
    parsed_occurred_date = parse_optional_iso_date(occurred_date, field="occurred_date")
    parsed_occurred_time = parse_optional_iso_time(occurred_time, field="occurred_time")
    proof_data = proof or None
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids")

    # The service re-checks ownership and status under the row lock (race-free).
    geo = resolve_live_event(db, geolocation_id)
    try:
        edited = asyncio.run(
            events_service.save_version(
                db,
                geo=geo,
                current_user=current_user,
                title=title,
                lat=lat,
                lng=lng,
                occurred_date=parsed_occurred_date,
                occurred_time=parsed_occurred_time,
                proof_data=proof_data,
                tag_ids=parsed_tag_ids,
                conflict_ids=parsed_conflict_ids,
                sources=parsed_sources,
                proof_files=proof_files,
                note=note,
                expected_version=version_no,
                geolocator_invites=parsed_invites,
            )
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)
    except versions_service.VersionLimitError as exc:
        raise_version_error(exc)
    except GeolocatorCreditError as exc:
        raise_credit_error(exc)
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
    """The event's superseded versions, newest first.

    Public: a corrected record is only auditable if corrections are readable.
    The live row is the current version and is not listed. Visibility as
    ``GET /{id}``.

    Paged: ``services/versions.HISTORY_PAGE_SIZE`` rows by default, capped at
    100, following the ``Link: rel="next"`` cursor. ``total`` is the whole
    history.
    """
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
    """One superseded version of an event, by its number.

    The direct read behind the ``/vN`` address, visibility-gated like the list.
    The live row's number answers 404 (read it at ``GET /{id}``), as does a
    number the event never carried. A redacted version answers with its
    blanked shape.
    """
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
    """Your collections, each saying whether this event is already on it.

    The add-to-collection popover's read, for an analyst credited on the event
    (its owner or a co-geolocator). Empty collections are listed. 404 on a
    soft-deleted or withheld event, 403 when you are not credited.
    """
    geo = resolve_live_event(db, geolocation_id)
    try:
        collections_service.ensure_credited(db, event_id=geo.id, user=current_user)
    except collections_service.CollectionError as exc:
        raise_typed_error(exc, collections_service.COLLECTION_ERROR_STATUS)
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
    """Close an event: withdraw, reject or retract it (owner-only).

    One terminal verb for all three, in every live state;
    ``before_closed_status`` records the state left and the required
    ``close_reason`` is public. The row stays readable and drops off the map. A
    closed detection stays in the located catalog and re-importable; closing a
    ``geolocated`` row is a public retraction that keeps the page, versions,
    credits and archives and leaves the published set for good. Already closed
    409; soft-deleted 404; not the owner 403.
    """
    geo = resolve_live_event(db, geolocation_id)
    try:
        closed = events_service.close(
            db, geo=geo, current_user=current_user, close_reason=body.close_reason
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    return _serialize_event(db, closed)
