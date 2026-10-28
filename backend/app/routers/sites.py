"""The ``/sites`` endpoints: named areas of interest, their sources and contours, their
versions, and the events linked to them.

Rules live in ``services/sites``; this module resolves the row, hands the verb its
arguments and maps a typed service error to its status.
"""

import uuid
from datetime import UTC, datetime
from typing import NoReturn

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
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
    SiteCreate,
    SiteCreatedRead,
    SiteList,
    SiteOverlapCheck,
    SiteOverlapRead,
    SiteRead,
    SiteSourceCreate,
    SiteSourceFiledRead,
    SiteSuggestionRead,
    SiteVersionCreate,
    SiteVersionList,
    SiteVersionRead,
)
from app.services import reports as reports_service
from app.services import sites as sites_service
from app.services.event_filters import parse_bbox, parse_optional_iso_date
from app.services.events import InvalidCoordinatesError
from app.services.evidence_intake import EvidenceIntakeError
from app.services.pagination import (
    decode_ordinal_cursor,
    encode_ordinal_cursor,
    page_size,
    paged,
)
from app.services.source_archive import SnapshotRejected
from app.services.versions import HISTORY_PAGE_SIZE, VersionLimitError

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
    """Create a site with its first source, the contour that source shows and your linked events.

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


@router.get("/suggestions", response_model=list[SiteSuggestionRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_site_suggestions(
    request: Request,
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    margin_m: float = Query(2000, ge=0, le=sites_service.MAX_MARGIN_M),
    q: str | None = Query(None, min_length=1, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SiteSuggestionRead]:
    """Sites a point may link to, nearest first: those within ``margin_m`` metres of ``lat``,
    ``lng``, or with ``q``, those whose name contains it. Capped at 20."""
    try:
        return sites_service.suggest_sites_near(db, lat=lat, lng=lng, margin_m=margin_m, q=q)
    except InvalidCoordinatesError as exc:
        raise_typed_error(exc, sites_service.SITE_ERROR_STATUS)


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
    """One site: current zone and last source, sources, contours and visible linked events.
    A withheld site is a 404 for everyone but an admin."""
    return sites_service.build_site_read(db, _resolve(db, site_id, current_user))


@router.post("/{site_id}/versions", response_model=SiteRead)
@limiter.limit("30/minute")
def save_site_version(
    request: Request,
    site_id: uuid.UUID,
    body: SiteVersionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SiteRead:
    """Edit your site in one transaction: name, kind, added and removed sources, contour changes
    and your linked events. Owner only.

    A change to the record, the sources or a contour files the superseded state as one version;
    a change to your links alone files none. 409 ``version_mismatch`` when ``version_no`` names
    a version the site has moved past, 409 ``nothing_changed`` when nothing changes.
    """
    site = _resolve(db, site_id, None)
    try:
        site = sites_service.save_version(db, site=site, user=current_user, body=body)
    except _WRITE_ERRORS as exc:
        _raise_site_error(exc)
    return sites_service.build_site_read(db, site)


@router.get("/{site_id}/versions", response_model=SiteVersionList)
@authenticated_read_quota
@limiter.limit("120/minute")
def list_site_versions(
    request: Request,
    response: Response,
    site_id: uuid.UUID,
    limit: int = Query(HISTORY_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SiteVersionList:
    """The site's superseded versions, newest first. The live state is not listed.

    Paged like ``GET /events/{id}/versions``; ``total`` is the whole history.
    """
    site = _resolve(db, site_id, current_user)
    size = page_size(limit)
    window = sites_service.list_versions(
        db,
        site.id,
        limit=size,
        cursor=decode_ordinal_cursor(cursor) if cursor is not None else None,
    )
    rows = paged(request, response, window, size, lambda r: encode_ordinal_cursor(r.version_no))
    return SiteVersionList(
        items=sites_service.build_version_reads(db, rows),
        total=sites_service.count_versions(db, site.id),
    )


@router.get("/{site_id}/versions/{version_no}", response_model=SiteVersionRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_site_version(
    request: Request,
    site_id: uuid.UUID,
    version_no: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> SiteVersionRead:
    """One superseded version of a site, by its number. The live number answers 404."""
    site = _resolve(db, site_id, current_user)
    try:
        row = sites_service.get_version(db, site_id=site.id, version_no=version_no)
    except sites_service.SiteError as exc:
        _raise_site_error(exc)
    (read,) = sites_service.build_version_reads(db, [row])
    return read


@router.post(
    "/{site_id}/sources",
    response_model=SiteSourceFiledRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
def file_site_source(
    request: Request,
    site_id: uuid.UUID,
    body: SiteSourceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SiteSourceFiledRead:
    """File a dated satellite source on a site, filing a version. Any signed-in analyst; a site
    source is never edited."""
    site = _resolve(db, site_id, None)
    try:
        return sites_service.file_site_source(db, site=site, author=current_user, body=body)
    except _WRITE_ERRORS as exc:
        _raise_site_error(exc)


@router.delete("/{site_id}/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def remove_site_source(
    request: Request,
    site_id: uuid.UUID,
    source_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove a source you filed from the site, filing a version. 409 ``source_carries_contour``
    while the source carries a contour."""
    site = _resolve(db, site_id, None)
    try:
        sites_service.remove_site_source(db, site=site, user=current_user, source_id=source_id)
    except _WRITE_ERRORS as exc:
        _raise_site_error(exc)
