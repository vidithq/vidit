"""Write endpoints: create a geolocated event, and open a request.

Proof images ride inside the create multipart (``proof_files`` matched to
``placeholder://`` srcs), so there is no standalone proof-image endpoint. Source
files are staged first (``POST /uploads``) and named in ``sources``.
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
from app.models.event import TITLE_MAX_LENGTH
from app.models.user import User
from app.ratelimit import limiter
from app.routers._forms import (
    parse_json_id_list,
    parse_optional_iso_date,
    parse_optional_iso_time,
)
from app.routers.events._common import (
    SOURCES_FIELD_DESCRIPTION,
    _raise_event_error,
    build_event_read,
    parse_sources,
    raise_archive_error,
)
from app.schemas.event import (
    EventRead,
)
from app.services import events as events_service
from app.services.evidence_intake import EvidenceIntakeError
from app.services.source_archive import SnapshotRejected

router = APIRouter()


# Both creates are plain ``def`` driving their async service through
# ``asyncio.run``, so queries stay off the event loop (``engineering.md``,
# Request concurrency).
@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_event(
    request: Request,
    # ``max_length`` ceilings (shared with the versioned write via the model module) reject
    # over-length input before any work.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    # Optional; NULL reads as "Unknown". No ``max_length``: ``date.fromisoformat``
    # is the source of truth (a cap of 10 would reject ``2026-05-01T00:00:00``
    # with a generic 422).
    occurred_date: str | None = Form(None),
    # Optional hour of day (HH:MM, UTC).
    occurred_time: str | None = Form(None),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    sources: str = Form(..., description=SOURCES_FIELD_DESCRIPTION),
    # Proof images resolve against the proof's placeholders.
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Direct geolocate: create an event born ``geolocated``.

    Parses the form into clean types; business rules and IO live in
    ``services/events.create_with_evidence``. A pasted archived copy that is not
    a snapshot is a 400 with the failing check's code and no event is created.
    """
    parsed_sources = parse_sources(sources)
    proof_files = proof_files or []

    # Form(str) doesn't validate date shape; a raw value would 500 at flush.
    # 422 matches ``parse_bbox``.
    parsed_occurred_date = parse_optional_iso_date(occurred_date, field="occurred_date")
    parsed_occurred_time = parse_optional_iso_time(occurred_time, field="occurred_time")

    proof_data = proof or None
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids")

    try:
        geo = asyncio.run(
            events_service.create_with_evidence(
                db,
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
            )
        )
    except EvidenceIntakeError as exc:
        _raise_event_error(exc)
    except SnapshotRejected as exc:
        raise_archive_error(exc)

    # Born ``geolocated`` with no request, so ``requested_by`` is null.
    return build_event_read(geo, lat=lat, lng=lng)


@router.post("/requests", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_event_request(
    request: Request,
    # Ceilings mirror the direct-create form.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    proof: str | None = Form(None),
    # An approximate guess is allowed (both halves or neither).
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    # Often unknown.
    occurred_date: str | None = Form(None),
    occurred_time: str | None = Form(None),
    tag_ids: str | None = Form(None),
    conflict_ids: str | None = Form(None),
    sources: str = Form(..., description=SOURCES_FIELD_DESCRIPTION),
    # Optional inline proof images, as on the direct-create form.
    proof_files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Open a request (a ``requested`` event).

    The footage the poster has must be on the row from the start: a direct or
    indirect source with its file. Business rules and IO live in
    ``services/events.create_request``.
    """
    parsed_sources = parse_sources(sources)
    if not title.strip():
        raise HTTPException(status_code=400, detail="title is required")

    proof_files = proof_files or []

    proof_data = proof or None
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    parsed_conflict_ids = parse_json_id_list(conflict_ids, field="conflict_ids")
    # ``occurred_time`` may stand alone: an approximate hour is knowable without a date.
    parsed_occurred_date = parse_optional_iso_date(occurred_date, field="occurred_date")
    parsed_occurred_time = parse_optional_iso_time(occurred_time, field="occurred_time")

    try:
        geo = asyncio.run(
            events_service.create_request(
                db,
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

    # Project the optional guess in Python rather than a second ST_X/ST_Y query.
    guess_lat: float | None = None
    guess_lng: float | None = None
    if geo.coords is not None:
        point = cast(Point, to_shape(geo.coords))
        guess_lat, guess_lng = point.y, point.x
    return build_event_read(geo, lat=guess_lat, lng=guess_lng)
