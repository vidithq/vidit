"""Write endpoints — create a geolocation, and upload an inline proof image."""

import logging
from datetime import UTC, datetime, timedelta

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
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_current_user, get_db
from app.models.event import SOURCE_URL_MAX_LENGTH, TITLE_MAX_LENGTH
from app.models.proof_image import ProofImage
from app.models.user import User
from app.ratelimit import limiter
from app.routers._forms import (
    parse_iso_date,
    parse_iso_datetime,
    parse_json_id_list,
    parse_optional_iso_time,
    parse_optional_json_object,
)
from app.routers.events._common import _raise_geolocation_error, build_geolocation_read
from app.schemas.event import (
    EventRead,
)
from app.schemas.media import MediaUploadResponse
from app.services import events as events_service
from app.services.audit import extract_client_ip, extract_user_agent
from app.services.evidence_intake import EvidenceIntakeError
from app.services.evidence_processing import EvidenceProcessingError
from app.services.storage import (
    get_storage,
    safe_original_filename,
    sweep_keys,
    upload_proof_image,
    validate_file,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post(
    "/proof-images",
    status_code=status.HTTP_201_CREATED,
    response_model=MediaUploadResponse,
)
@limiter.limit("30/minute")
async def upload_proof_image_endpoint(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload an inline image referenced from the proof Tiptap document.

    Inserts a `proof_images` row with `event_id=NULL` so the upload
    is tracked before the form is submitted. It's linked to a geolocation
    when `POST /geolocations` runs and the URL survives sanitization; if
    the form is abandoned the row stays orphan and is reaped via the admin
    Maintenance panel (`services/maintenance.py::reap_proof_image_orphans`).

    Rate-limited at two layers: 30/minute per IP (slowapi) and a per-user
    rolling-24h DB ceiling, so one account can't fill the bucket via IP
    rotation.
    """
    # Route through the shared validator so the content-type allow-list +
    # size cap drift in one place. ``validate_file`` accepts image and
    # video; this endpoint is image-only by contract (proof body never
    # embeds video), so the video branch is rejected explicitly below.
    try:
        media_type = validate_file(file)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if media_type != "image":
        raise HTTPException(
            status_code=400,
            detail=f"File type {file.content_type} not allowed (image required)",
        )

    # Per-user rolling-24h ceiling. Cheap via ix_proof_images_user_id.
    # TOCTOU: two concurrent uploads can both pass this check and briefly
    # exceed the cap by a small constant. Acceptable — the cap is a soft
    # backstop, not exact-quota enforcement, and the 30/min IP limit
    # bounds practical abuse alongside it.
    cutoff = datetime.now(UTC) - timedelta(hours=24)
    recent = (
        db.query(ProofImage)
        .filter(
            ProofImage.user_id == current_user.id,
            ProofImage.created_at >= cutoff,
        )
        .count()
    )
    if recent >= settings.max_proof_images_per_user_per_day:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Per-user upload ceiling reached "
                f"({settings.max_proof_images_per_user_per_day} in 24h). "
                f"Try again later."
            ),
        )

    try:
        result = await upload_proof_image(file, current_user.id)
    except EvidenceProcessingError as exc:
        # Corrupt / truncated image — surface as 400 before we touch the DB.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    url = result.url
    key = get_storage().key_from_url(url)
    # Proof images opt out of derivatives (``produce_derivatives=False`` in
    # ``upload_proof_image``), so ``result.derivative_keys`` is ``()`` here
    # today. The cleanup paths still spread the field so a future flip of
    # the kwarg has the rollback paths already sweeping them. (No assert —
    # asserts strip under ``python -O``, so they're not a safety check.)
    if key is None:
        # Storage returned a URL we can't invert — refuse to ship a row we
        # could never garbage-collect. The just-uploaded object stays
        # orphaned until the reaper's next pass; logging is the only
        # recovery available here.
        logger.error(
            "Proof-image upload landed at unrecognised URL prefix %s; "
            "object orphaned until next reaper pass",
            url,
        )
        raise HTTPException(
            status_code=500,
            detail="Storage returned an unrecognised URL prefix",
        )

    db.add(
        ProofImage(
            s3_key=key,
            user_id=current_user.id,
            sha256=result.sha256,
            uploaded_ip=extract_client_ip(request),
            uploaded_user_agent=extract_user_agent(request),
            original_filename=safe_original_filename(file.filename),
        )
    )
    try:
        db.commit()
    except Exception:
        # DB unavailable post-upload — without a row the reaper never finds
        # this object. Best-effort delete the original plus derivatives
        # (``()`` today; the spread covers a future ``produce_derivatives``
        # flip without a separate edit).
        db.rollback()
        sweep_keys([key, *result.derivative_keys], context="proof-image upload commit failure")
        raise
    return {"url": url, "sha256": result.sha256}


@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_geolocation(
    request: Request,
    # ``max_length`` ceilings (shared with the edit form via the model module) so
    # over-length input is rejected at the boundary, not at flush time AFTER the
    # attached files hit S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
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
    files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    files = files or []

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
            source_url=source_url,
            event_date=parsed_event_date,
            event_time=parsed_event_time,
            source_posted_at=parsed_source_posted_at,
            proof_data=proof_data,
            tag_ids=parsed_tag_ids,
            files=files,
            uploaded_ip=extract_client_ip(request),
            uploaded_user_agent=extract_user_agent(request),
        )
    except EvidenceIntakeError as exc:
        _raise_geolocation_error(exc)

    # A direct create is born ``geolocated`` with no preceding request, so
    # ``requested_by`` is null — ``build_geolocation_read`` reads it off the row.
    return build_geolocation_read(geo, lat=lat, lng=lng)
