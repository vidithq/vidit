"""The ``/sites`` endpoints: named areas of interest, their imagery history and contours, and
the events near them.

Rules live in ``services/sites``; this module resolves the row, hands the verb its
arguments and maps a typed service error to its status.
"""

import uuid
from datetime import UTC, datetime
from typing import Literal, NoReturn

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.content_report import ContentReport
from app.models.site import Site
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import ARCHIVE_ERROR_STATUS
from app.schemas.report import ContentReportCreate, ContentReportRead
from app.schemas.site import (
    SiteContourCreate,
    SiteContourRead,
    SiteCreate,
    SiteCreatedRead,
    SiteHistoryEntry,
    SiteImageCreate,
    SiteImageFiledRead,
    SiteList,
    SiteNearbyEventRead,
    SiteOverlapCheck,
    SiteOverlapRead,
    SiteRead,
    SiteUpdate,
)
from app.services import reports as reports_service
from app.services import sites as sites_service
from app.services.event_filters import parse_bbox, parse_optional_iso_date
from app.services.evidence_intake import EvidenceIntakeError
from app.services.source_archive import SnapshotRejected
from app.services.versions import VersionLimitError

router = APIRouter()

_WRITE_ERRORS = (sites_service.SiteError, EvidenceIntakeError, SnapshotRejected, VersionLimitError)
_WRITE_ERROR_STATUS = {**sites_service.SITE_ERROR_STATUS, **ARCHIVE_ERROR_STATUS}


def _raise_site_error(
    exc: sites_service.SiteError | EvidenceIntakeError | SnapshotRejected | VersionLimitError,
) -> NoReturn:
    raise_typed_error(exc, _WRITE_ERROR_STATUS)


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

    A site with no contour on or before ``as_of`` is absent. Capped at 1000 sites.
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
    """Create a site with its first image and the contour that image shows.

    ``overlapping_sites`` lists the visible sites whose current zone shares area with the new
    one, as a duplicate warning; it never blocks the create.
    """
    try:
        site, overlaps = sites_service.create_site(db, owner=current_user, body=body)
    except _WRITE_ERRORS as exc:
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


@router.post(
    "/{site_id}/report",
    response_model=ContentReportRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/hour")
def report_site(
    request: Request,
    site_id: uuid.UUID,
    body: ContentReportCreate,
    background_tasks: BackgroundTasks,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> ContentReport:
    """Report a site for moderation.

    Same gesture, body and per-IP limit as an event report: open to anonymous viewers. An
    unknown or withheld site answers 404 ``site_not_found``.
    """
    try:
        return reports_service.create_site_report(
            db,
            site_id=site_id,
            reason=body.reason,
            details=body.details,
            reporter_id=current_user.id if current_user is not None else None,
            reporter_username=current_user.username if current_user is not None else None,
            background_tasks=background_tasks,
        )
    except reports_service.ReportError as exc:
        raise_typed_error(exc, reports_service.REPORT_ERROR_STATUS)


@router.get("/{site_id}", response_model=SiteRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_site(
    request: Request,
    site_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SiteRead:
    """One site: current zone and last image, images, contours and visible linked events.
    A withheld site is a 404 for everyone but an admin."""
    return sites_service.build_site_read(db, _resolve(db, site_id, current_user))


@router.patch("/{site_id}", response_model=SiteRead)
@limiter.limit("30/minute")
def edit_site(
    request: Request,
    site_id: uuid.UUID,
    body: SiteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SiteRead:
    """Change your site's name or kind; the superseded record is kept. Owner only."""
    site = _resolve(db, site_id, None)
    try:
        site = sites_service.edit_site(db, site=site, user=current_user, body=body)
    except _WRITE_ERRORS as exc:
        _raise_site_error(exc)
    return sites_service.build_site_read(db, site)


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
    """The site's history: creation, record edits, images, contours, and every link, unlink and
    effect change.

    ``order=fact`` sorts by when each fact happened on the ground, ``order=recorded`` by when
    it entered Vidit.
    """
    site = _resolve(db, site_id, current_user)
    return sites_service.site_history(db, site=site, order=order)


@router.post(
    "/{site_id}/images",
    response_model=SiteImageFiledRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
def file_image(
    request: Request,
    site_id: uuid.UUID,
    body: SiteImageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SiteImageFiledRead:
    """File a dated satellite image in a site's imagery history. Any signed-in analyst; an
    image is never edited."""
    site = _resolve(db, site_id, None)
    try:
        return sites_service.file_image(db, site=site, author=current_user, body=body)
    except _WRITE_ERRORS as exc:
        _raise_site_error(exc)


@router.post(
    "/{site_id}/contours",
    response_model=SiteContourRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
def change_contour(
    request: Request,
    site_id: uuid.UUID,
    body: SiteContourCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SiteContourRead:
    """Draw a new contour of your site, citing one of its images. Owner only."""
    site = _resolve(db, site_id, None)
    try:
        return sites_service.change_contour(db, site=site, user=current_user, body=body)
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
