"""Single-event ops by id: detail, lifecycle verbs (geolocate, close), the
open-request correction (update_request) and the published-row correction
(save_version + version history).

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
    parse_optional_iso_datetime,
    parse_optional_iso_time,
    parse_optional_json_object,
)
from app.routers.events._common import (
    SecondarySourceUrl,
    _raise_event_error,
    build_event_read,
    build_version_read,
    raise_archive_error,
    raise_version_error,
    resolve_live_event,
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
from app.services.pagination import (
    decode_ordinal_cursor,
    encode_ordinal_cursor,
    next_link,
    page_size,
    take_page,
)
from app.services.permissions import ensure_owner
from app.services.source_archive import SnapshotRejected
from app.services.thumbnails import thumbnail_media_criteria

router = APIRouter()

# Every relationship the detail serializer reads, eager-loaded to bound queries.
_DETAIL_LOADS = (
    joinedload(Event.owner),
    joinedload(Event.requested_by),
    selectinload(Event.media.and_(thumbnail_media_criteria())),
    selectinload(Event.tags),
    selectinload(Event.conflicts),
    selectinload(Event.geolocators).joinedload(EventGeolocator.user),
    # ``build_event_read`` reads this set; without it, a lazy query per event.
    selectinload(Event.archives),
    selectinload(Event.source_links),
)


def _serialize_event(db: Session, geo: Event) -> EventRead:
    """Build the read model for a just-mutated row, re-projecting the points
    the way ``GET /{id}`` does so the shapes match."""
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
    ``reporter_user_id`` NULL. The per-IP limit is the abuse floor.

    An unknown, soft-deleted or already-withheld event answers 404.
    """
    try:
        return reports_service.create_event_report(
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

    A withheld event (``hidden_at``) answers 404 for everyone but an admin,
    who must read what was taken down to judge the report.
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


# ── Lifecycle verbs ───────────────────────────────────────────────────
# Geolocate moves a ``requested`` or ``detected`` event to ``geolocated``;
# close is the terminal withdraw / reject / retract, in every live state. A
# detection is owner-only; a ``requested`` event is answerable by anyone (the
# fulfiller becomes the owner). A ``requested`` row is corrected through
# ``update_request`` (overwrites, owner-only: a request is a question, so no
# vouched version exists to supersede). A ``geolocated`` row is corrected
# through ``save_version`` (owner-only, files the superseded version). An
# owner's way out of a published claim is the retraction; destruction is
# admin-only. See ``api.md``.
#
# The three multipart writes are plain ``def`` driving their async service
# through ``asyncio.run``, so their queries and the row lock held across the
# upload stay off the event loop (``engineering.md``, Request concurrency).


@router.post("/{geolocation_id}/geolocate", response_model=EventRead)
@limiter.limit("30/minute")
def geolocate_event(
    request: Request,
    geolocation_id: uuid.UUID,
    # Multipart like create: the service writes the whole form and flips to
    # ``geolocated`` atomically. ``max_length`` uses the shared model constants
    # so over-length input is rejected before files hit S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    # Archived copy of the stored source URL, checked against what this write stores.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Mirrors, repeated per link. The list REPLACES what the row held, even on a
    # requested fulfilment (no requester protection, see the service docstring).
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    # Archived copy of each mirror, aligned by position with the list above and
    # blank where not archived: the client posts one entry per mirror so
    # ``pair_secondary_snapshots`` can key them before normalization drops rows.
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
    # Optional like create; NULL reads as "Unknown".
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    source_posted_at: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    # Graphic-content declaration. Ratchets: omitting it keeps an existing
    # flag; only the admin moderation endpoint clears one.
    is_graphic: bool = Form(False),
    # Ids of media to drop (JSON array). A replacement source rides in
    # ``files``; new inline proof images in ``proof_files``.
    remove_media_ids: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Give an event a vouched location: ``requested`` | ``detected`` → ``geolocated``.

    The caller posts the whole form (title, coordinates, source URL, dates,
    graphic flag, proof + images, tags, source media via ``files`` /
    ``remove_media_ids``). On success the row is published as ``geolocated`` and
    the caller is credited as a geolocator; later corrections go through
    ``save_version``. A detection is owner-only (403 otherwise); a ``requested``
    event is answerable by anyone and the fulfiller becomes its owner
    (``requested_by`` keeps the poster). Blocked (400) until the evidence floor
    is met (one source media, a proof image, a conflict, the ``capture_source``
    tag). Other statuses 409; soft-deleted 404.

    ``source_snapshot_url`` and ``secondary_snapshot_urls`` record archived
    copies in the same write, on the checks every archived-copy field runs (a
    paste that is not a snapshot of its link is a 400 and nothing is written).
    Changing the source URL without pasting a new snapshot leaves no archived
    source rather than the old one's copy.
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

    # The service enforces per-status ownership under a row lock.
    geo = resolve_live_event(db, geolocation_id)
    try:
        geolocated = asyncio.run(
            events_service.geolocate(
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
                secondary_snapshot_urls=secondary_snapshot_urls,
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
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)
    return _serialize_event(db, geolocated)


@router.post("/{geolocation_id}/request", response_model=EventRead)
@limiter.limit("30/minute")
def update_event_request(
    request: Request,
    geolocation_id: uuid.UUID,
    # Multipart like ``POST /events/requests``: same fields and ceilings. The
    # source media uses the plural swap pair the published writes take, since
    # the row already carries a file.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
    proof: str | None = Form(None),
    # The approximate guess a request may carry: both halves or neither.
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    # Optional: the bot opens requests whose source date it could not read.
    # Empty or omitted keeps what the row holds (NULL included).
    source_posted_at: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    is_graphic: bool = Form(False),
    # Ids of source media to drop (JSON array); the replacement rides in ``files``.
    remove_media_ids: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Correct an open request, overwriting it in place (owner-only).

    No version is filed: a version supersedes a vouched claim, and a request is
    a question. The row keeps its id, ``requested_at``, requester and
    provenance columns, and moves ``updated_at``. Allowed only while
    ``requested`` (409 otherwise).

    Every create-form field is editable, the coordinate guess and camera point
    included; the curated floor stays unenforced until geolocate. Source media
    moves on the ``remove_media_ids`` + ``files`` pair under the one-source cap
    and the row must still carry footage. Soft-deleted rows read as 404.
    """
    files = files or []
    proof_files = proof_files or []
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")

    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids", as_uuid=True)
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids", as_uuid=True)
    parsed_remove_ids = parse_json_id_list(remove_media_ids, field="remove_media_ids")
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_optional_iso_datetime(
        source_posted_at, field="source_posted_at"
    )

    # The service re-checks ownership and status under the row lock (race-free).
    geo = resolve_live_event(db, geolocation_id)
    try:
        edited = asyncio.run(
            events_service.update_request(
                db,
                geo=geo,
                current_user=current_user,
                title=title,
                source_url=source_url,
                source_snapshot_url=source_snapshot_url,
                secondary_source_urls=secondary_source_urls,
                secondary_snapshot_urls=secondary_snapshot_urls,
                proof_data=proof_data,
                lat=lat,
                lng=lng,
                capture_source_lat=capture_source_lat,
                capture_source_lng=capture_source_lng,
                event_date=parsed_event_date,
                event_time=parsed_event_time,
                source_posted_at=parsed_source_posted_at,
                tag_ids=parsed_tag_ids,
                conflict_ids=parsed_conflict_ids,
                is_graphic=is_graphic,
                remove_media_ids=parsed_remove_ids,
                files=files,
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
    # Multipart like geolocate: the service writes the editable state and the
    # superseded version atomically.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    # Footage origin, versioned with the rest. Optional here: omitted or empty
    # keeps the row's value (FastAPI reads empty as absent); whitespace-only is
    # a 400 since a published row always carries one.
    source_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Archived copy of the source URL this write stores.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Archived copy of a machine detection's origin post. The provenance link
    # is immutable; archiving it is not a change. Absent on human submits.
    detected_from_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Mirrors: the list replaces what the row held. The archived copy of each
    # rides in ``secondary_snapshot_urls``, index-aligned (one entry per mirror,
    # blank where none) so a copy never arrives without its link.
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    # Optional: a detection with an unresolved source post time publishes with
    # NULL, so an edit must be able to leave it NULL. Absent or empty keeps the
    # row's value; a value replaces it.
    source_posted_at: str | None = Form(None),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    # Ratchets as on geolocate.
    is_graphic: bool = Form(False),
    # The editor's note, stored on the version this edit supersedes.
    note: str | None = Form(None, max_length=VERSION_NOTE_MAX_LENGTH),
    # Ids of media to drop (JSON array); the filed version keeps the dropped
    # one renderable.
    remove_media_ids: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    # New inline proof images, matched to ``placeholder://`` srcs.
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Correct a published event, keeping the version it replaces readable.

    Owner-only and only while ``geolocated`` (409 otherwise). The pre-edit state
    is filed as an ``event_versions`` row and the event moves to the next
    ``version_no``, in one transaction under a row lock.

    The evidence anchor is versioned too: ``source_url`` and the source media
    (``remove_media_ids`` + ``files``, one-source cap) are editable, and the
    filed version keeps what it supersedes. The published evidence floor is
    re-checked on the post-edit state. Soft-deleted rows read as 404.

    Archived copies are recorded here too: ``source_snapshot_url``,
    ``detected_from_snapshot_url`` and ``secondary_snapshot_urls`` archive a link
    without changing it and land in the produced version. A save whose only
    change is a copy is accepted even at the version ceiling.
    """
    proof_files = proof_files or []
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_optional_iso_datetime(
        source_posted_at, field="source_posted_at"
    )
    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids", as_uuid=True)
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids", as_uuid=True)
    parsed_remove_ids = parse_json_id_list(remove_media_ids, field="remove_media_ids")

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
                capture_source_lat=capture_source_lat,
                capture_source_lng=capture_source_lng,
                source_url=source_url,
                source_snapshot_url=source_snapshot_url,
                detected_from_snapshot_url=detected_from_snapshot_url,
                secondary_source_urls=secondary_source_urls,
                secondary_snapshot_urls=secondary_snapshot_urls,
                event_date=parsed_event_date,
                event_time=parsed_event_time,
                source_posted_at=parsed_source_posted_at,
                proof_data=proof_data,
                tag_ids=parsed_tag_ids,
                conflict_ids=parsed_conflict_ids,
                is_graphic=is_graphic,
                remove_media_ids=parsed_remove_ids,
                files=files or [],
                proof_files=proof_files,
                note=note,
            )
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)
    except versions_service.VersionLimitError as exc:
        raise_version_error(exc)
    return _serialize_event(db, edited)


def _readable_event(db: Session, geolocation_id: uuid.UUID, current_user: User | None) -> Event:
    """The event a history read may serve, or a 404.

    Same visibility as ``GET /{id}`` (soft-deleted hidden from all, withheld
    visible to admins), shared so the two history reads cannot diverge.
    """
    query = db.query(Event).filter(Event.id == geolocation_id, Event.deleted_at.is_(None))
    if current_user is None or not current_user.is_admin:
        query = query.filter(Event.hidden_at.is_(None))
    geo = query.first()
    if geo is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return geo


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
    geo = _readable_event(db, geolocation_id, current_user)

    size = page_size(limit)
    window = versions_service.list_versions(
        db,
        geo.id,
        limit=size,
        cursor=decode_ordinal_cursor(cursor) if cursor is not None else None,
    )
    rows, has_next = take_page(window, size)
    if has_next:
        last = rows[-1]
        response.headers["Link"] = next_link(request, encode_ordinal_cursor(last.version_no))
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
    geo = _readable_event(db, geolocation_id, current_user)
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

    The add-to-collection popover's read, owner-only. Empty collections are
    listed. 404 on a soft-deleted or withheld event, 403 when not yours.
    """
    geo = resolve_live_event(db, geolocation_id)
    ensure_owner(geo, current_user)
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
