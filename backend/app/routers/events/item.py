"""Single-event ops by id: detail, delete, the lifecycle verbs (geolocate,
close), and the published-row correction path (save_version + its version history)."""

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
from app.schemas.event import (
    VERSION_NOTE_MAX_LENGTH,
    EventCloseRequest,
    EventRead,
    EventVersionList,
    EventVersionRead,
)
from app.schemas.report import ContentReportCreate, ContentReportRead
from app.services import events as events_service
from app.services import permissions
from app.services import reports as reports_service
from app.services import versions as versions_service
from app.services.evidence_intake import EvidenceIntakeError, collect_event_media_keys
from app.services.pagination import (
    decode_ordinal_cursor,
    encode_ordinal_cursor,
    next_link,
    page_size,
    take_page,
)
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
    rows, media rows and filed versions; the S3 objects (media of every role,
    the source image derivatives, and the source media a correction superseded,
    which outlive their row so history stays renderable) are swept after the
    commit lands. Admin soft-delete lives behind the admin router and stamps
    ``deleted_at`` instead.
    """
    geo = resolve_live_event(db, geolocation_id)
    permissions.ensure_owner(geo, current_user)

    # Snapshot the S3 keys before the cascade drops the rows, then
    # commit-then-sweep (see ``services.storage.sweep_keys``).
    media_keys = collect_event_media_keys(db, geo)

    db.delete(geo)
    db.commit()

    sweep_keys(media_keys, context=f"event {geo.id} delete")

    points_cache.invalidate()


# ── Lifecycle verbs ───────────────────────────────────────────────────
# Geolocate writes the caller's edits and moves a ``requested`` or
# ``detected`` event to ``geolocated``; close is the terminal withdraw /
# reject. A detection is owner-only; a ``requested`` event is
# answerable by anyone (the fulfiller becomes the owner). Past the geolocate a
# row is corrected through ``save_version``, owner-only, which files the superseded
# version rather than overwriting it. See ``api.md``.


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
    # The archived copy of each mirror, aligned with the list above by position
    # and blank where that mirror was not archived. The alignment is the
    # contract: the client posts one entry here per entry there, blank included,
    # so a copy never arrives without the link it covers and
    # ``pair_secondary_snapshots`` can key the two by position before
    # normalization drops any row.
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
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
    success the row is written and published as ``geolocated``, with the caller
    credited as a geolocator; from there it is corrected through ``save_version``,
    which files each superseded version. Only ``detected_from_url`` (provenance) and
    ``status`` carry no field. A detection is owner-only (403
    otherwise); a ``requested`` event is answerable by anyone, and the
    fulfiller becomes its owner (``requested_by`` keeps the original poster).
    Blocked until the evidence floor is met (one source media, a proof image,
    a conflict, and the ``capture_source`` tag, 400 otherwise). Off
    ``requested`` / ``detected`` → 409. Soft-deleted rows read as 404.

    ``source_snapshot_url`` records the archived source in the same write and
    ``secondary_snapshot_urls`` records one copy per mirror, on the checks every
    archived-copy field runs (a paste that is not a snapshot of the link it sits
    beside is a 400, and nothing is written). An edit that changes the source URL
    and pastes no new snapshot leaves the event with no archived source rather
    than the old one's copy.
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
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)
    return _serialize_event(db, geolocated)


@router.post("/{geolocation_id}/versions", response_model=EventRead)
@limiter.limit("30/minute")
async def save_event_version(
    request: Request,
    geolocation_id: uuid.UUID,
    # Multipart, mirroring geolocate: the form posts the whole editable state
    # and the service writes it, plus the superseded version, atomically.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    # The footage origin, editable here as on geolocate and versioned with the
    # rest. Optional, unlike on geolocate: absent keeps what the row holds, and
    # a blank value is a 400, since a published row always carries one.
    source_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # The archived copy of the source URL this write stores.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # The archived copy of the post a machine detection came from, on the same
    # terms: the provenance link is immutable, and archiving it is not a change
    # to it. Absent on a human submit, which carries no provenance link.
    detected_from_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # The mirrors, repeated once per link. Outside the anchor, so the submitted
    # list replaces whatever the row held; the archived copy of each rides
    # beside it, aligned by position. The two lists are index-aligned by
    # contract: the client posts one ``secondary_snapshot_urls`` entry per
    # ``secondary_source_urls`` entry, blank where that mirror carries no copy,
    # so a copy is never posted without the link it covers.
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    # Optional, unlike on geolocate: a detection whose source post time was
    # never resolved publishes with the column NULL, so an edit of that row must
    # be able to leave it NULL. Absent or empty keeps whatever the row holds
    # (NULL included), a value replaces it.
    source_posted_at: str | None = Form(None),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    # Ratchets exactly as on geolocate: a posted false leaves a flagged event
    # flagged, and only the admin moderation endpoint clears one.
    is_graphic: bool = Form(False),
    # The editor's own words about this edit, stored on the version it
    # supersedes. Optional.
    note: str | None = Form(None, max_length=VERSION_NOTE_MAX_LENGTH),
    # Ids of existing media to drop (JSON array), as on geolocate: the
    # replacement source rides in ``files``, and the version this call files
    # keeps the dropped one renderable.
    remove_media_ids: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    # The proof body's new inline images, matched to its ``placeholder://`` srcs.
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Correct a published event, keeping the version it replaces readable.

    Owner-only, and only while ``geolocated`` (409 otherwise): a correction to a
    vouched record must not silently rewrite it, so the pre-edit state is filed
    as an ``event_versions`` row and the event moves to the next
    ``version_no``, in one transaction under a row lock.

    The evidence anchor is editable, and versioned with everything else:
    ``source_url`` takes a field here, and the source media moves on the
    ``remove_media_ids`` + ``files`` pair ``POST /events/{id}/geolocate`` takes,
    under the same one-source cap. The version this call files carries the
    source URL and the source media it supersedes, so the record still shows
    what the claim rested on. The published evidence floor is re-checked on the
    post-edit state, so a version cannot drop the row below it. Soft-deleted
    rows read as 404.

    This is also where an archived copy of one of the row's links is recorded:
    ``source_snapshot_url``, ``detected_from_snapshot_url`` and
    ``secondary_snapshot_urls`` archive a link without changing it, and land in
    the version this call produces. A save whose only change is a copy is
    accepted even at the version ceiling, since evidence preservation never
    waits on a quota.
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

    # Not owner-gated at the router: the service re-checks ownership and status
    # under the row lock, where the decision is race-free.
    geo = resolve_live_event(db, geolocation_id)
    try:
        edited = await events_service.save_version(
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
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)
    except versions_service.VersionLimitError as exc:
        raise_version_error(exc)
    return _serialize_event(db, edited)


def _readable_event(db: Session, geolocation_id: uuid.UUID, current_user: User | None) -> Event:
    """The event a history read is allowed to serve, or a 404.

    Soft-deleted rows are invisible to everyone; a withheld row is invisible to
    everyone but an admin, who still needs to read what was taken down in order
    to judge the report that took it down. The same branch ``GET /{id}`` takes,
    shared by the two history reads so one of them cannot start serving a
    takedown the other hides.
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

    Public, like the event itself: a corrected record is only auditable if the
    corrections are readable. The live row is the current version and is not
    listed here, so an event nobody has edited answers with an empty list.
    Soft-deleted rows read as 404; a withheld row does too for everyone but an
    admin, who still needs to read what was taken down in order to judge the
    report that took it down (the same branch ``GET /{id}`` takes).

    Paged like every other list: ``services/versions.HISTORY_PAGE_SIZE`` rows by
    default, capped at 100 however large ``limit`` is, and a caller reading past
    the first page follows the ``cursor`` in the ``Link: rel="next"`` header.
    ``total`` is the whole history, not the page.
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

    The direct read behind the ``/vN`` address: a reader opening one version
    reads that version, rather than walking the history until the page holding
    it comes back. Public and visibility-gated exactly like the list above.

    The live row is the current version and is not filed here, so its number
    answers 404: ``GET /{id}`` is where the current version is read. A number
    the event never carried answers 404 too, and a redacted version answers
    with its blanked shape rather than a 404, since the version exists and the
    record still shows that it does.
    """
    geo = _readable_event(db, geolocation_id, current_user)
    row = versions_service.get_version(db, event_id=geo.id, version_no=version_no)
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return build_version_read(row)


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
