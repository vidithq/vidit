"""Single-event ops by id — detail, delete, and the lifecycle verbs
(geolocate, close, investigate)."""

import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.cache import points_cache
from app.dependencies import get_current_user, get_db
from app.models.event import (
    SOURCE_URL_MAX_LENGTH,
    STATUS_REQUESTED,
    TITLE_MAX_LENGTH,
    Event,
    EventGeolocator,
    EventInvestigator,
)
from app.models.user import User
from app.ratelimit import limiter
from app.routers._forms import (
    parse_iso_date,
    parse_iso_datetime,
    parse_json_id_list,
    parse_optional_iso_time,
    parse_optional_json_object,
)
from app.routers.events._common import _raise_event_error, build_event_read
from app.schemas.event import EventCloseRequest, EventRead
from app.services import events as events_service
from app.services import permissions
from app.services.evidence_intake import EvidenceIntakeError, collect_media_keys
from app.services.storage import (
    sweep_keys,
)

router = APIRouter()

# Every relationship the detail serializer reads, eager-loaded so one event
# costs a bounded set of queries (no per-contributor lazy hits).
_DETAIL_LOADS = (
    joinedload(Event.owner),
    joinedload(Event.requested_by),
    selectinload(Event.media),
    selectinload(Event.tags),
    selectinload(Event.geolocators).joinedload(EventGeolocator.user),
    selectinload(Event.investigators).joinedload(EventInvestigator.user),
)


def _resolve_live_event(db: Session, geolocation_id: uuid.UUID) -> Event:
    """Fetch a live event by id, or 404.

    A soft-deleted row reads as 404 (an admin-removed row isn't actionable —
    same surface as a genuine 404, no enumeration oracle). Permission is the
    caller's concern: the geolocate transition owns per-status ownership (a
    ``requested`` event is answerable by anyone).
    """
    geo = db.query(Event).filter(Event.id == geolocation_id, Event.deleted_at.is_(None)).first()
    if geo is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return geo


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


@router.get("/{geolocation_id}", response_model=EventRead)
@limiter.limit("120/minute")
def get_event(request: Request, geolocation_id: uuid.UUID, db: Session = Depends(get_db)):
    row = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
            ST_Y(Event.capture_source_coords).label("capture_lat"),
            ST_X(Event.capture_source_coords).label("capture_lng"),
        )
        .options(*_DETAIL_LOADS)
        .filter(Event.id == geolocation_id, Event.deleted_at.is_(None))
        .first()
    )
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
    # Filter out soft-deleted rows: an admin-removed row shouldn't be
    # owner-actionable either — same observed behaviour as a genuine 404.
    geo = _resolve_live_event(db, geolocation_id)
    permissions.ensure_owner(geo, current_user)

    # Snapshot the S3 keys before the cascade drops the rows; the objects are
    # deleted after the commit so a failed commit doesn't strand referenced
    # files.
    media_keys = collect_media_keys(list(geo.media))

    db.delete(geo)
    db.commit()

    # On per-key S3 failures (transient outage, key already gone) the rows
    # are already deleted — swallow and log (accepted residual orphan risk).
    sweep_keys(media_keys, context=f"event {geo.id} delete")

    points_cache.invalidate()


# ── Lifecycle verbs ───────────────────────────────────────────────────
# Geolocate writes the caller's edits and moves a ``requested`` or
# ``detected`` event to ``geolocated``; close is the terminal withdraw /
# reject. A ``detected`` draft is owner-only; a ``requested`` event is
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
    event_date: str = Form(...),
    event_time: str | None = Form(None),
    source_posted_at: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
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
    form (title, coordinates, source URL, dates, proof + its images, tags, and
    the source media: ``files`` added, ``remove_media_ids`` dropped), and on
    success the row is written and frozen as ``geolocated``, with the caller
    credited as a geolocator. Only ``detected_from_url`` (provenance) and
    ``status`` carry no field. A ``detected`` draft is owner-only (403
    otherwise); a ``requested`` event is answerable by anyone, and the
    fulfiller becomes its owner (``requested_by`` keeps the original poster).
    Blocked until the evidence floor is met (one source media, a proof image,
    and the ``conflict`` + ``capture_source`` tags — 400 otherwise). Off
    ``requested`` / ``detected`` → 409. Soft-deleted rows read as 404.
    """
    files = files or []
    proof_files = proof_files or []
    parsed_event_date = parse_iso_date(event_date, field="event_date")
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")
    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    parsed_remove_ids = parse_json_id_list(remove_media_ids, field="remove_media_ids")

    # Not owner-gated at the router: the service enforces per-status ownership
    # (owner-only for ``detected``, open for ``requested``) under a row lock.
    geo = _resolve_live_event(db, geolocation_id)
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
            event_date=parsed_event_date,
            event_time=parsed_event_time,
            source_posted_at=parsed_source_posted_at,
            proof_data=proof_data,
            tag_ids=parsed_tag_ids,
            remove_media_ids=parsed_remove_ids,
            files=files,
            proof_files=proof_files,
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
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
    geo = _resolve_live_event(db, geolocation_id)
    try:
        closed = events_service.close(
            db, geo=geo, current_user=current_user, close_reason=body.close_reason
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    return _serialize_event(db, closed)


@router.post("/{geolocation_id}/investigate", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def investigate_event(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Signal "I'm working on this". Idempotent — re-signalling is a 204
    no-op, not a 409. Only open requests accept new signals; off
    ``requested`` the signal is rejected with 409.
    """
    geo = _resolve_live_event(db, geolocation_id)
    if geo.status != STATUS_REQUESTED:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot investigate an event with status {geo.status}",
        )

    existing = (
        db.query(EventInvestigator)
        .filter(
            EventInvestigator.event_id == geo.id,
            EventInvestigator.user_id == current_user.id,
        )
        .first()
    )
    if existing is not None:
        return

    # The SELECT above is the friendly-path read; the ``EventInvestigator``
    # composite PK ``(event_id, user_id)`` is the actual race backstop.
    # A double-click or two tabs both pass the SELECT, only one wins the
    # INSERT — without this SAVEPOINT the loser sees a 500 from the
    # unhandled ``IntegrityError`` instead of the idempotent 204. Mirrors
    # ``services/social.follow_user``.
    try:
        with db.begin_nested():
            db.add(EventInvestigator(event_id=geo.id, user_id=current_user.id))
    except IntegrityError:
        # Loser of the race — the row exists, which IS the post-condition.
        pass
    db.commit()


@router.delete("/{geolocation_id}/investigate", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def uninvestigate_event(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stop signalling. 204 even if the caller wasn't signalling — the
    user-observable post-condition (caller not in the working set) is
    what we promise, not "exactly one row was deleted." Gated to
    ``requested`` like the POST: a terminated event's signals are frozen
    history.
    """
    geo = _resolve_live_event(db, geolocation_id)
    if geo.status != STATUS_REQUESTED:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot investigate an event with status {geo.status}",
        )

    db.query(EventInvestigator).filter(
        EventInvestigator.event_id == geo.id,
        EventInvestigator.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
