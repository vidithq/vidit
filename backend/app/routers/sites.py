"""The ``/sites`` endpoints: durable places, their dated zones, and the events near them.

Rules live in ``services/sites``; this module resolves the row, hands the verb its
arguments and maps a typed service error to its status.
"""

import uuid
from datetime import UTC, datetime
from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.site import Site
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.schemas.site import (
    SiteCreate,
    SiteCreatedRead,
    SiteHistoryEntry,
    SiteList,
    SiteNearbyEventRead,
    SiteObservationCreate,
    SiteObservationRead,
    SiteOverlapCheck,
    SiteOverlapRead,
    SiteRead,
)
from app.services import sites as sites_service
from app.services.event_filters import parse_bbox, parse_optional_iso_date

router = APIRouter()


def _raise_site_error(exc: sites_service.SiteError) -> NoReturn:
    raise_typed_error(exc, sites_service.SITE_ERROR_STATUS)


def _resolve(db: Session, site_id: uuid.UUID, viewer: User | None) -> Site:
    try:
        return sites_service.resolve_site(db, site_id=site_id, viewer=viewer)
    except sites_service.SiteError as exc:
        _raise_site_error(exc)


@router.get("", response_model=list[SiteList])
@authenticated_read_quota
@limiter.limit("60/minute")
def list_sites(
    request: Request,
    bbox: str = Query(..., description="south,west,north,east"),
    as_of: str | None = Query(None, description="YYYY-MM-DD; defaults to today (UTC)"),
    db: Session = Depends(get_db),
) -> list[SiteList]:
    """The visible sites whose zone valid on ``as_of`` meets the box, newest site first.

    A site with no observation on or before ``as_of`` is absent. Capped at 1000 sites.
    """
    day = parse_optional_iso_date(as_of, field="as_of") or datetime.now(UTC).date()
    return sites_service.list_sites(db, bounds=parse_bbox(bbox), as_of=day)


@router.post("", response_model=SiteCreatedRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_site(
    request: Request,
    body: SiteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SiteCreatedRead:
    """Create a site with its first observation.

    ``overlapping_sites`` lists the visible sites whose current zone shares area with the new
    one, as a duplicate warning; it never blocks the create.
    """
    try:
        site, overlaps = sites_service.create_site(db, owner=current_user, body=body)
    except sites_service.SiteError as exc:
        _raise_site_error(exc)
    read = sites_service.build_site_read(db, site)
    return SiteCreatedRead(**read.model_dump(), overlapping_sites=overlaps)


@router.post("/overlaps", response_model=list[SiteOverlapRead])
@limiter.limit("60/minute")
def check_overlaps(
    request: Request,
    body: SiteOverlapCheck,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SiteOverlapRead]:
    """The visible sites whose current zone shares area with ``zone``, larger share first."""
    try:
        return sites_service.find_overlaps(db, body.zone)
    except sites_service.SiteError as exc:
        _raise_site_error(exc)


@router.get("/{site_id}", response_model=SiteRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_site(
    request: Request,
    site_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SiteRead:
    """One site: current zone and state, observations, and visible linked events.
    A withheld site is a 404 for everyone but an admin."""
    return sites_service.build_site_read(db, _resolve(db, site_id, current_user))


@router.get("/{site_id}/history", response_model=list[SiteHistoryEntry])
@authenticated_read_quota
@limiter.limit("120/minute")
def get_site_history(
    request: Request,
    site_id: uuid.UUID,
    order: Literal["fact", "recorded"] = Query("fact"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[SiteHistoryEntry]:
    """The site's history: creation, observations, and every link, unlink and effect change.

    ``order=fact`` sorts by when each fact happened on the ground, ``order=recorded`` by when
    it entered Vidit.
    """
    site = _resolve(db, site_id, current_user)
    return sites_service.site_history(db, site=site, order=order)


@router.post(
    "/{site_id}/observations",
    response_model=SiteObservationRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
def add_observation(
    request: Request,
    site_id: uuid.UUID,
    body: SiteObservationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SiteObservationRead:
    """Add a dated zone to a site. Any signed-in analyst; observations are never edited."""
    site = _resolve(db, site_id, None)
    try:
        return sites_service.add_observation(db, site=site, author=current_user, body=body)
    except sites_service.SiteError as exc:
        _raise_site_error(exc)


@router.get("/{site_id}/nearby-events", response_model=list[SiteNearbyEventRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_nearby_events(
    request: Request,
    site_id: uuid.UUID,
    margin_m: float = Query(2000, ge=0, le=sites_service.MAX_MARGIN_M),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> list[SiteNearbyEventRead]:
    """Visible events within ``margin_m`` metres of the current zone and not linked to the
    site, nearest first. Capped at 50."""
    site = _resolve(db, site_id, current_user)
    return sites_service.nearby_events(db, site=site, margin_m=margin_m)
