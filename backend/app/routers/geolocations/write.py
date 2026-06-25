"""Write endpoints — create a geolocation, and upload an inline proof image."""

import json
import logging
import uuid
from datetime import UTC, date, datetime, timedelta

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
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.dependencies import get_current_user, get_db
from app.models.bounty import Bounty
from app.models.proof_image import ProofImage
from app.models.user import User
from app.ratelimit import limiter
from app.routers.geolocations._common import _raise_geolocation_error
from app.schemas.geolocation import (
    GeolocationRead,
)
from app.schemas.media import MediaUploadResponse
from app.services import geolocations as geolocations_service
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

    Inserts a `proof_images` row with `geolocation_id=NULL` so the upload
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


@router.post("", response_model=GeolocationRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def create_geolocation(
    request: Request,
    # ``max_length`` ceilings match the DB columns (title String(255),
    # source_url String(2000)) so over-length input is rejected at the
    # boundary, not at flush time AFTER the attached files hit S3.
    title: str = Form(..., min_length=1, max_length=255),
    lat: float = Form(...),
    lng: float = Form(...),
    source_url: str = Form(..., max_length=2000),
    # No ``max_length`` on ``event_date``: ``date.fromisoformat`` is the
    # source of truth (and implicitly bounds length). Capping at 10 would
    # reject a valid ``2026-05-01T00:00:00`` with a generic Pydantic 422
    # instead of our custom message.
    event_date: str = Form(...),
    # Optional: the date the original source posted the media. Same loose
    # ``str`` shape as ``event_date`` — parsed below, not by Pydantic.
    source_date: str | None = Form(None),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    bounty_id: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    files = files or []

    # ── Parse HTTP-shape inputs. Business rules + IO live in the service.

    # event_date: Form(str) doesn't validate date shape; feeding the raw
    # value into ``Geolocation.event_date`` (Mapped[date]) would 500 at
    # flush, AFTER the S3 round-trips. 422 matches ``_parse_bbox`` /
    # ``_parse_filter_date`` so malformed-input rejections share a code.
    try:
        parsed_event_date = date.fromisoformat(event_date)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="event_date must be an ISO-8601 date (YYYY-MM-DD)",
        ) from exc

    # Optional — empty string / absent → None. Same 422-on-garbage contract.
    parsed_source_date: date | None = None
    if source_date:
        try:
            parsed_source_date = date.fromisoformat(source_date)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail="source_date must be an ISO-8601 date (YYYY-MM-DD)",
            ) from exc

    parsed_bounty_id: uuid.UUID | None = None
    if bounty_id:
        try:
            parsed_bounty_id = uuid.UUID(bounty_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bounty_id must be a UUID") from exc

    try:
        proof_data = json.loads(proof) if proof else None
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in 'proof': {exc.msg}") from exc
    if proof_data is not None and not isinstance(proof_data, dict):
        raise HTTPException(status_code=400, detail="'proof' must be a JSON object")

    try:
        parsed_tag_ids = json.loads(tag_ids) if tag_ids else []
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid JSON in 'tag_ids': {exc.msg}"
        ) from exc
    if not isinstance(parsed_tag_ids, list):
        raise HTTPException(status_code=400, detail="'tag_ids' must be a JSON array")

    try:
        geo = await geolocations_service.create_with_evidence(
            db,
            current_user=current_user,
            title=title,
            lat=lat,
            lng=lng,
            source_url=source_url,
            event_date=parsed_event_date,
            source_date=parsed_source_date,
            proof_data=proof_data,
            tag_ids=parsed_tag_ids,
            bounty_id=parsed_bounty_id,
            files=files,
            uploaded_ip=extract_client_ip(request),
            uploaded_user_agent=extract_user_agent(request),
        )
    except EvidenceIntakeError as exc:
        _raise_geolocation_error(exc)

    # If promoted from a bounty, reload the relationship so the response
    # carries the trace without a separate client fetch. Read-only response
    # assembly — stays in the router.
    originated_from_bounty = None
    if geo.originated_from_bounty_id is not None:
        originated_from_bounty = (
            db.query(Bounty)
            .options(joinedload(Bounty.author))
            .filter(Bounty.id == geo.originated_from_bounty_id)
            .first()
        )

    return GeolocationRead(
        id=geo.id,
        title=geo.title,
        lat=lat,
        lng=lng,
        source_url=geo.source_url,
        proof=geo.proof,
        event_date=geo.event_date,
        source_date=geo.source_date,
        created_at=geo.created_at,
        updated_at=geo.updated_at,
        is_demo=geo.is_demo,
        state=geo.state,
        detected_from_url=geo.detected_from_url,
        author=geo.author,
        media=geo.media,
        tags=geo.tags,
        # Pydantic ``from_attributes`` coerces the ``Bounty`` row into the
        # nested schema at runtime; mypy doesn't follow it, so it sees
        # ``Bounty | None`` where the schema declares
        # ``_OriginatedFromBountyNested | None``.
        originated_from_bounty=originated_from_bounty,  # type: ignore[arg-type]
    )
