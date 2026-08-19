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
    # The archived copy of ``source_url``, if the analyst made one while filling
    # the form (the form opens the provider pages prefilled with the source and
    # takes the snapshot back here). Optional; checked against ``source_url``
    # and stored with the event.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Mirrors of the same media elsewhere, repeated once per link. Optional and
    # ordered; the service normalizes and caps them.
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    # The archived copy of each mirror, repeated once per entry above and
    # aligned with it by position; blank where that mirror was not archived.
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
    # Optional: the footage doesn't always establish when the depicted event
    # happened; NULL reads as "Unknown". No ``max_length``:
    # ``date.fromisoformat`` is the source of truth (and implicitly bounds
    # length). Capping at 10 would reject a valid ``2026-05-01T00:00:00`` with
    # a generic Pydantic 422 instead of our custom message.
    event_date: str | None = Form(None),
    # Optional hour-of-day for the event (HH:MM, UTC). Parsed below.
    event_time: str | None = Form(None),
    # When the source posted the media: a full datetime (datetime-local
    # ``YYYY-MM-DDTHH:MM``, read as UTC). Required: a post always has a time.
    source_posted_at: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    # The author's graphic-content declaration; defaults to FALSE so an older
    # client that omits the field submits an unflagged event.
    is_graphic: bool = Form(False),
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

    ``source_snapshot_url`` records the event's archived source in the same
    write, and ``secondary_snapshot_urls`` records one copy per mirror: the same
    checks ``POST /events/{id}/archives`` runs, so a paste that is not a
    snapshot of the link it sits beside is a 400 carrying the failing check's
    code, and no event is created.
    """
    proof_files = proof_files or []

    # ── Parse HTTP-shape inputs. Business rules + IO live in the service.

    # event_date: Form(str) doesn't validate date shape; feeding the raw
    # value into ``Event.event_date`` (Mapped[date]) would 500 at
    # flush, AFTER the S3 round-trips. 422 matches ``parse_bbox`` so
    # malformed-input rejections share a code.
    parsed_event_date = parse_optional_iso_date(event_date, field="event_date")
    # Optional hour → None when absent; required source instant, read as UTC.
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")

    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids", as_uuid=True)
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids", as_uuid=True)

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
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)

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
    # The archived copy of ``source_url``, as on the direct-create form: one
    # form posts either shape, so the analyst's paste is kept on both.
    source_snapshot_url: str | None = Form(None, max_length=SOURCE_URL_MAX_LENGTH),
    # Mirrors of the same media elsewhere, as on the direct-create form, and
    # the archived copy of each, aligned with them by position.
    secondary_source_urls: list[SecondarySourceUrl] = Form([]),
    secondary_snapshot_urls: list[SecondarySourceUrl] = Form([]),
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
    conflict_ids: str | None = Form(None),
    # A request carries the poster's footage from the start, so it declares the
    # flag on the same terms as a direct submit.
    is_graphic: bool = Form(False),
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
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids", as_uuid=True)
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids", as_uuid=True)
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
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)

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
