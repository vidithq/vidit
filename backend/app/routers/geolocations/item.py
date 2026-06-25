"""Single-geolocation ops by id — detail, delete, and the ``detected`` review flow (edit / validate / reject)."""

import uuid

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    status,
)
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.orm import Session, joinedload

from app.cache import points_cache
from app.dependencies import get_current_user, get_db
from app.models.bounty import Bounty
from app.models.geolocation import Geolocation
from app.models.proof_image import ProofImage
from app.models.user import User
from app.ratelimit import limiter
from app.routers.geolocations._common import _raise_geolocation_error
from app.schemas.geolocation import (
    GeolocationRead,
    GeolocationUpdate,
)
from app.services import geolocations as geolocations_service
from app.services import permissions
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
        originated_from_bounty=geo.originated_from_bounty,
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
        originated_from_bounty=geo.originated_from_bounty,
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
# Edit completes a detection, validate freezes it (detected → validated),
# reject soft-deletes it. All three are owner-only and state-gated to
# ``detected``; a ``validated`` row is immutable (409). See ``api.md``.


@router.patch("/{geolocation_id}", response_model=GeolocationRead)
@limiter.limit("30/minute")
def update_geolocation(
    request: Request,
    geolocation_id: uuid.UUID,
    payload: GeolocationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Owner edit of a ``detected`` geolocation (review flow).

    Editable only while ``detected``; a ``validated`` row is frozen (409).
    ``source_url`` / source media / ``detected_from_url`` / ``state`` are
    immutable and carry no field on the body. Partial: only the fields the
    request sends are touched. Soft-deleted rows read as 404.
    """
    geo = _resolve_owned_geolocation(db, geolocation_id, current_user)
    try:
        updated = geolocations_service.update_detected(db, geo=geo, payload=payload)
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
    ``detected`` → 409 (a ``validated`` row goes through ``DELETE``).
    Soft-deleted → 404.
    """
    geo = _resolve_owned_geolocation(db, geolocation_id, current_user)
    try:
        geolocations_service.reject_detected(db, geo=geo)
    except EvidenceIntakeError as exc:
        _raise_geolocation_error(exc)
