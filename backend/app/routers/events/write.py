"""Write endpoints: create a geolocated event, and open a request.

Proof images ride inside the create multipart (``proof_files`` matched to
``placeholder://`` srcs), so there is no standalone proof-image endpoint.
"""

import asyncio
from typing import cast

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
from geoalchemy2.shape import to_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.event import SOURCE_URL_MAX_LENGTH, TITLE_MAX_LENGTH
from app.models.user import User
from app.ratelimit import limiter
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
)
from app.schemas.event import (
    EventRead,
)
from app.services import events as events_service
from app.services.evidence_intake import EvidenceIntakeError
from app.services.source_archive import SnapshotRejected

router = APIRouter()


def _capture_coords(geo) -> tuple[float | None, float | None]:
    """Project a just-written row's camera point from its WKB, skipping an ST_X/ST_Y query."""
    if geo.capture_source_coords is None:
        return None, None
    point = cast(Point, to_shape(geo.capture_source_coords))
    return point.y, point.x


# Both creates are plain ``def`` driving their async service through
# ``asyncio.run``, so queries stay off the event loop (``engineering.md``,
# Request concurrency).
@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_event(
    request: Request,
    # ``max_length`` ceilings (shared with geolocate via the model module) reject
    # over-length input before attached files hit S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    # Optional camera point.
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    # Archived copy of ``source_url``, checked against it and stored with the event.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Mirrors, repeated per link; the service normalizes and caps them.
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    # Archived copy of each mirror, aligned by position; blank where not archived.
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
    # Optional; NULL reads as "Unknown". No ``max_length``: ``date.fromisoformat``
    # is the source of truth (a cap of 10 would reject ``2026-05-01T00:00:00``
    # with a generic 422).
    event_date: str | None = Form(None),
    # Optional hour of day (HH:MM, UTC).
    event_time: str | None = Form(None),
    # Required: ``YYYY-MM-DDTHH:MM``, read as UTC.
    source_posted_at: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    # Graphic-content declaration; an omitting client submits unflagged.
    is_graphic: bool = Form(False),
    # Exactly one source file; proof images resolve against the doc's placeholders.
    file: UploadFile = File(...),
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Direct geolocate: create an event born ``geolocated``.

    Parses the form into clean types; business rules and IO live in
    ``services/events.create_with_evidence``.

    ``source_snapshot_url`` and ``secondary_snapshot_urls`` record archived
    copies in the same write (``services/source_archive``); a paste that is
    not a snapshot of its link is a 400 with the failing check's code and no
    event is created.
    """
    proof_files = proof_files or []

    # ── Parse HTTP-shape inputs.

    # Form(str) doesn't validate date shape; a raw value would 500 at flush
    # after the S3 round-trips. 422 matches ``parse_bbox``.
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    # Optional hour; the source instant is required, read as UTC.
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")

    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids", as_uuid=True)
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids", as_uuid=True)

    try:
        geo = asyncio.run(
            events_service.create_with_evidence(
                db,
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
                file=file,
                proof_files=proof_files,
            )
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)

    # Born ``geolocated`` with no request, so ``requested_by`` is null.
    capture_lat, capture_lng = _capture_coords(geo)
    return build_event_read(geo, lat=lat, lng=lng, capture_lat=capture_lat, capture_lng=capture_lng)


@router.post("/requests", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_event_request(
    request: Request,
    # Ceilings mirror the direct-create form so over-length input 422s before
    # the file hits S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    # Archived copy of ``source_url``, as on the direct-create form.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Mirrors and their archived copies, as on the direct-create form.
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
    proof: str | None = Form(None),
    # An approximate guess is allowed (both halves or neither).
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    # Event date is optional (often unknown); the source timestamp is required.
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    source_posted_at: str = Form(...),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    # A request carries footage from the start, so it declares the flag like a submit.
    is_graphic: bool = Form(False),
    file: UploadFile = File(...),
    # Optional inline proof images, as on the direct-create form.
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Open a request (a ``requested`` event).

    One source media file is required: the evidence the poster has must be on
    the row from the start. Business rules and IO live in
    ``services/events.create_request``.
    """
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")

    proof_files = proof_files or []

    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids", as_uuid=True)
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids", as_uuid=True)
    # ``event_time`` may stand alone: an approximate hour is knowable without a date.
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")

    try:
        geo = asyncio.run(
            events_service.create_request(
                db,
                current_user=current_user,
                title=title,
                source_url=source_url,
                secondary_source_urls=secondary_source_urls,
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
                file=file,
                proof_files=proof_files,
                source_snapshot_url=source_snapshot_url,
                secondary_snapshot_urls=secondary_snapshot_urls,
            )
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)

    # Project the optional guess in Python rather than a second ST_X/ST_Y query.
    guess_lat: float | None = None
    guess_lng: float | None = None
    if geo.event_coords is not None:
        point = cast(Point, to_shape(geo.event_coords))
        guess_lat, guess_lng = point.y, point.x
    capture_lat, capture_lng = _capture_coords(geo)
    return build_event_read(
        geo, lat=guess_lat, lng=guess_lng, capture_lat=capture_lat, capture_lng=capture_lng
    )
