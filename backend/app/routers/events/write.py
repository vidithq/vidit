"""Write endpoints: create a geolocated event, and open a request.

Proof images ride INSIDE the create multipart (``proof_files`` matched to
``placeholder://`` srcs in the proof document), so there is no standalone
proof-image upload endpoint and no unattached staging row to reap.
"""

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
    parse_iso_date,
    parse_iso_datetime,
    parse_json_id_list,
    parse_optional_iso_date,
    parse_optional_iso_time,
    parse_optional_json_object,
)
from app.routers.events._common import _raise_event_error, build_event_read
from app.schemas.event import (
    EventRead,
)
from app.services import events as events_service
from app.services.evidence_intake import EvidenceIntakeError

router = APIRouter()


def _capture_coords(geo) -> tuple[float | None, float | None]:
    """Project a just-written row's camera point without a second query.

    The create paths already hold the WKB on the refreshed row; ``to_shape``
    beats an ST_X/ST_Y round-trip for a single point.
    """
    if geo.capture_source_coords is None:
        return None, None
    point = cast(Point, to_shape(geo.capture_source_coords))
    return point.y, point.x


@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_event(
    request: Request,
    # ``max_length`` ceilings (shared with the geolocate form via the model
    # module) so over-length input is rejected at the boundary, not at flush
    # time AFTER the attached files hit S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    # The optional camera point (where the footage was shot from).
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    # No ``max_length`` on ``event_date``: ``date.fromisoformat`` is the
    # source of truth (and implicitly bounds length). Capping at 10 would
    # reject a valid ``2026-05-01T00:00:00`` with a generic Pydantic 422
    # instead of our custom message.
    event_date: str = Form(...),
    # Optional hour-of-day for the event (HH:MM, UTC). Parsed below.
    event_time: str | None = Form(None),
    # When the source posted the media: a full datetime (datetime-local
    # ``YYYY-MM-DDTHH:MM``, read as UTC). Required: a post always has a time.
    source_posted_at: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    # Exactly one source file (the footage); the proof body's inline images
    # ride alongside it and resolve against the doc's placeholder srcs.
    file: UploadFile = File(...),
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Direct geolocate: create an event born ``geolocated``.

    Parses the multipart form into clean Python types; business rules + IO
    (the evidence floor, the S3 uploads, the placeholder resolution) live in
    ``services/events.create_with_evidence``.
    """
    proof_files = proof_files or []

    # ── Parse HTTP-shape inputs. Business rules + IO live in the service.

    # event_date: Form(str) doesn't validate date shape; feeding the raw
    # value into ``Event.event_date`` (Mapped[date]) would 500 at
    # flush, AFTER the S3 round-trips. 422 matches ``_parse_bbox`` /
    # ``_parse_filter_date`` so malformed-input rejections share a code.
    parsed_event_date = parse_iso_date(event_date, field="event_date")
    # Optional hour → None when absent; required source instant, read as UTC.
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")

    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")

    try:
        geo = await events_service.create_with_evidence(
            db,
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
            file=file,
            proof_files=proof_files,
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)

    # A direct create is born ``geolocated`` with no preceding request, so
    # ``requested_by`` is null, so ``build_event_read`` reads it off the row.
    capture_lat, capture_lng = _capture_coords(geo)
    return build_event_read(geo, lat=lat, lng=lng, capture_lat=capture_lat, capture_lng=capture_lng)


@router.post("/requests", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_event_request(
    request: Request,
    # ``max_length`` ceilings mirror the direct-create form: title is the DB
    # column width (String(255)), source_url a chosen API bound, so
    # over-length input 422s at the boundary, not at flush time AFTER the
    # attached file has already hit S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    proof: str | None = Form(None),
    # An approximate guess is allowed on a request (both halves or neither).
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    capture_source_lat: float | None = Form(None),
    capture_source_lng: float | None = Form(None),
    # Event date optional (often unknown for a request); the source is a post,
    # so its timestamp is required. Same loose ``str`` shapes, parsed below.
    event_date: str | None = Form(None),
    event_time: str | None = Form(None),
    source_posted_at: str = Form(...),
    tag_ids: str | None = Form(None),
    file: UploadFile = File(...),
    # The proof body's inline images (optional on a request), matched to the
    # doc's ``placeholder://`` srcs, same as the direct-create form.
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Open a request (a ``requested`` event).

    One source media file is required: the platform treats requests as
    "unfinished geolocations", so the evidence the poster has must be on the
    row from the start. Parses the multipart form into clean Python types;
    business rules + IO live in ``services/events.create_request``.
    """
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")

    proof_files = proof_files or []

    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    # event_date is optional on a request, and event_time may stand alone: an
    # approximate hour-of-day (sun position / shadows) is knowable without the
    # date, so a time is NOT gated on a date.
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")

    try:
        geo = await events_service.create_request(
            db,
            current_user=current_user,
            title=title,
            source_url=source_url,
            proof_data=proof_data,
            lat=lat,
            lng=lng,
            capture_source_lat=capture_source_lat,
            capture_source_lng=capture_source_lng,
            event_date=parsed_event_date,
            event_time=parsed_event_time,
            source_posted_at=parsed_source_posted_at,
            tag_ids=parsed_tag_ids,
            file=file,
            proof_files=proof_files,
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)

    # Serialise off the refreshed row; a request's guess is optional, so both
    # points project in Python rather than via a second ST_X/ST_Y query.
    guess_lat: float | None = None
    guess_lng: float | None = None
    if geo.event_coords is not None:
        point = cast(Point, to_shape(geo.event_coords))
        guess_lat, guess_lng = point.y, point.x
    capture_lat, capture_lng = _capture_coords(geo)
    return build_event_read(
        geo, lat=guess_lat, lng=guess_lng, capture_lat=capture_lat, capture_lng=capture_lng
    )
