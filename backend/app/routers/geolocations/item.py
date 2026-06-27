"""Single-geolocation ops by id — detail, delete, and the ``detected`` review flow (edit / validate / reject)."""

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
from sqlalchemy.orm import Session, joinedload

from app.cache import points_cache
from app.dependencies import get_current_user, get_db
from app.models.bounty import Bounty
from app.models.geolocation import (
    SOURCE_URL_MAX_LENGTH,
    TITLE_MAX_LENGTH,
    Geolocation,
)
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
from app.routers.geolocations._common import _raise_geolocation_error, build_geolocation_read
from app.schemas.geolocation import GeolocationRead
from app.services import geolocations as geolocations_service
from app.services import permissions
from app.services.audit import extract_client_ip, extract_user_agent
from app.services.evidence_intake import EvidenceIntakeError
from app.services.storage import (
    sweep_keys,
)

router = APIRouter()


def _resolve_owned_geolocation(db: Session, geolocation_id: uuid.UUID, user: User) -> Geolocation:
    """Fetch a live geolocation the caller authored, or raise.

    The author-mutating idiom shared by the review-flow endpoints: a
    soft-deleted row reads as 404 (an admin-removed row isn't author-actionable
    either — same surface as a genuine 404, no enumeration oracle), a live row
    the caller didn't author is 403.
    """
    geo = (
        db.query(Geolocation)
        .filter(Geolocation.id == geolocation_id, Geolocation.deleted_at.is_(None))
        .first()
    )
    if geo is None:
        raise HTTPException(status_code=404, detail="Geolocation not found")
    permissions.ensure_author(geo, user)
    return geo


def _serialize_geolocation(db: Session, geo: Geolocation) -> GeolocationRead:
    """Build the read model for a just-mutated row.

    Re-projects ``lat`` / ``lng`` out of the PostGIS point with the same
    ``ST_Y`` / ``ST_X`` cast ``GET /{id}`` uses, so a review-flow mutation
    returns a response identical in shape to a fresh read.
    """
    lat, lng = (
        db.query(ST_Y(Geolocation.location), ST_X(Geolocation.location))
        .filter(Geolocation.id == geo.id)
        .one()
    )
    return build_geolocation_read(
        geo, lat=lat, lng=lng, originated_from_bounty=geo.originated_from_bounty
    )


@router.get("/{geolocation_id}", response_model=GeolocationRead)
@limiter.limit("120/minute")
def get_geolocation(request: Request, geolocation_id: uuid.UUID, db: Session = Depends(get_db)):
    row = (
        db.query(
            Geolocation,
            ST_Y(Geolocation.location).label("lat"),
            ST_X(Geolocation.location).label("lng"),
        )
        .options(
            joinedload(Geolocation.author),
            joinedload(Geolocation.media),
            joinedload(Geolocation.tags),
            joinedload(Geolocation.originated_from_bounty).joinedload(Bounty.author),
        )
        .filter(Geolocation.id == geolocation_id, Geolocation.deleted_at.is_(None))
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Geolocation not found")

    geo, lat, lng = row
    return build_geolocation_read(
        geo, lat=lat, lng=lng, originated_from_bounty=geo.originated_from_bounty
    )


@router.delete("/{geolocation_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_geolocation(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Filter out soft-deleted rows: an admin-removed row shouldn't be
    # author-actionable either — same observed behaviour as a genuine 404.
    geo = (
        db.query(Geolocation)
        .filter(Geolocation.id == geolocation_id, Geolocation.deleted_at.is_(None))
        .first()
    )
    if geo is None:
        raise HTTPException(status_code=404, detail="Geolocation not found")
    permissions.ensure_author(geo, current_user)

    # Snapshot inline proof image keys before cascade drops the rows; the
    # S3 objects are deleted after the commit so a failed commit doesn't
    # strand referenced files. Media files are a known parallel orphan
    # problem, not addressed here.
    proof_image_keys = [
        row[0]
        for row in db.query(ProofImage.s3_key).filter(ProofImage.geolocation_id == geo.id).all()
    ]

    db.delete(geo)
    db.commit()

    # On per-key S3 failures (transient outage, key already gone) the rows
    # are already deleted — swallow and log; the next reaper sweep, which
    # cross-references the table, picks the objects up.
    sweep_keys(proof_image_keys, context=f"geolocation {geo.id} delete")

    points_cache.invalidate()


# ── Owner review flow over machine ``detected`` rows ───────────────────────
# Edit completes a detection, validate freezes it (detected → human),
# reject soft-deletes it. All three are owner-only and state-gated to
# ``detected``; a ``human`` row is immutable (409). See ``api.md``.


@router.patch("/{geolocation_id}", response_model=GeolocationRead)
@limiter.limit("30/minute")
async def update_geolocation(
    request: Request,
    geolocation_id: uuid.UUID,
    # Multipart, mirroring create: the form posts the whole editable state and
    # the service applies it atomically. ``max_length`` ceilings are the shared
    # model constants (same as create) so over-length input is rejected before
    # the files hit S3.
    title: str = Form(..., min_length=1, max_length=TITLE_MAX_LENGTH),
    lat: float = Form(...),
    lng: float = Form(...),
    source_url: str = Form(..., max_length=SOURCE_URL_MAX_LENGTH),
    event_date: str = Form(...),
    event_time: str | None = Form(None),
    source_posted_at: str = Form(...),
    proof: str | None = Form(None),
    tag_ids: str | None = Form(None),
    # Ids of existing media to drop (JSON array). New media ride in ``files``.
    remove_media_ids: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Owner edit of a ``detected`` geolocation (review flow).

    Editable only while ``detected``; a ``human`` row is frozen (409). The
    owner curates the whole draft — title, coordinate, source URL, dates, proof,
    tags, and the source media (``files`` added, ``remove_media_ids`` dropped).
    Only ``detected_from_url`` (provenance) and ``state`` are immutable, so they
    carry no field. Soft-deleted rows read as 404.
    """
    files = files or []
    parsed_event_date = parse_iso_date(event_date, field="event_date")
    parsed_event_time = parse_optional_iso_time(event_time, field="event_time")
    parsed_source_posted_at = parse_iso_datetime(source_posted_at, field="source_posted_at")
    proof_data = parse_optional_json_object(proof, field="proof")
    parsed_tag_ids = parse_json_id_list(tag_ids, field="tag_ids")
    parsed_remove_ids = parse_json_id_list(remove_media_ids, field="remove_media_ids")

    geo = _resolve_owned_geolocation(db, geolocation_id, current_user)
    try:
        updated = await geolocations_service.update_detected(
            db,
            geo=geo,
            title=title,
            lat=lat,
            lng=lng,
            source_url=source_url,
            event_date=parsed_event_date,
            event_time=parsed_event_time,
            source_posted_at=parsed_source_posted_at,
            proof_data=proof_data,
            tag_ids=parsed_tag_ids,
            remove_media_ids=parsed_remove_ids,
            files=files,
            uploaded_ip=extract_client_ip(request),
            uploaded_user_agent=extract_user_agent(request),
        )
    except EvidenceIntakeError as exc:
        _raise_geolocation_error(exc)
    return _serialize_geolocation(db, updated)


@router.post("/{geolocation_id}/validate", response_model=GeolocationRead)
@limiter.limit("30/minute")
def validate_geolocation(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Validate a ``detected`` geolocation: ``detected → validated``, frozen.

    Owner-only. Blocked until the row carries the evidence floor of a human
    submit — at least one media and the ``conflict`` + ``capture_source`` tags
    (400 otherwise). Off ``detected`` → 409. Soft-deleted → 404.
    """
    geo = _resolve_owned_geolocation(db, geolocation_id, current_user)
    try:
        validated = geolocations_service.validate_detected(db, geo=geo)
    except EvidenceIntakeError as exc:
        _raise_geolocation_error(exc)
    return _serialize_geolocation(db, validated)


@router.post("/{geolocation_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def reject_geolocation(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reject a ``detected`` geolocation: soft-delete, re-importable later.

    Owner-only. Soft-deletes the row (so a later re-import recreates it fresh),
    distinct from the hard ``DELETE`` that removes a row for good. Off
    ``detected`` → 409 (a ``human`` row goes through ``DELETE``).
    Soft-deleted → 404.
    """
    geo = _resolve_owned_geolocation(db, geolocation_id, current_user)
    try:
        geolocations_service.reject_detected(db, geo=geo)
    except EvidenceIntakeError as exc:
        _raise_geolocation_error(exc)
