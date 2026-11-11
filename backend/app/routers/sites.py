"""The ``/sites`` endpoints: named areas of interest, their sources and contours, their
versions, and the events linked to them.

Rules live in ``services/sites``; this module resolves the row and hands the verb its
arguments.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Query, Request, Response, status

from app.dependencies import DB, CurrentUser, Cursor, OptionalUser
from app.models.content_report import ContentReport
from app.models.site import SiteVersion
from app.ratelimit import authenticated_read_quota, limiter
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
from app.services import versions as versions_service
from app.services.event_filters import parse_bbox, parse_optional_iso_date
from app.services.pagination import (
    decode_ordinal_cursor,
    encode_ordinal_cursor,
    page_size,
    paged,
)
from app.services.versions import HISTORY_PAGE_SIZE

router = APIRouter()


@router.get("", response_model=list[SiteList])
@authenticated_read_quota
@limiter.limit("60/minute")
def list_sites(
    request: Request,
    db: DB,
    bbox: str = Query(..., description="south,west,north,east"),
    as_of: str | None = Query(None, description="YYYY-MM-DD; defaults to today (UTC)"),
) -> list[SiteList]:
    """The visible sites whose zone valid on ``as_of`` meets the box, newest site first."""
    day = parse_optional_iso_date(as_of, field="as_of") or datetime.now(UTC).date()
    return sites_service.list_sites(db, bounds=parse_bbox(bbox), as_of=day)


@router.post("", response_model=SiteCreatedRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_site(
    request: Request, body: SiteCreate, db: DB, current_user: CurrentUser
) -> SiteCreatedRead:
    """Create a site with its first source, the contour that source shows and your linked events."""
    site, overlaps = sites_service.create_site(db, owner=current_user, body=body)
    read = sites_service.build_site_read(db, site)
    return SiteCreatedRead(**read.model_dump(), overlapping_sites=overlaps)


@router.post("/overlaps", response_model=list[SiteOverlapRead])
@limiter.limit("60/minute")
def check_overlaps(
    request: Request, body: SiteOverlapCheck, db: DB, current_user: CurrentUser
) -> list[SiteOverlapRead]:
    """The visible sites whose current zone shares area with ``zone``, larger share first."""
    return sites_service.find_overlaps(db, body.zone)


@router.get("/suggestions", response_model=list[SiteSuggestionRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_site_suggestions(
    request: Request,
    db: DB,
    current_user: CurrentUser,
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    margin_m: float = Query(sites_service.DEFAULT_MARGIN_M, ge=0, le=sites_service.MAX_MARGIN_M),
    q: str | None = Query(None, min_length=1, max_length=100),
) -> list[SiteSuggestionRead]:
    """Sites a point may link to, nearest first: those within ``margin_m`` metres of ``lat``,
    ``lng``, or with ``q``, those whose name contains it."""
    return sites_service.suggest_sites_near(db, lat=lat, lng=lng, margin_m=margin_m, q=q)


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
    current_user: OptionalUser,
    db: DB,
) -> ContentReport:
    """Report a site for moderation."""
    return reports_service.create_report(
        db,
        kind="site",
        target_id=site_id,
        body=body,
        reporter=current_user,
        background_tasks=background_tasks,
    )


@router.get("/{site_id}", response_model=SiteRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_site(request: Request, site_id: uuid.UUID, db: DB, current_user: OptionalUser) -> SiteRead:
    """One site: current zone and last source, sources, contours and visible linked events."""
    return sites_service.build_site_read(
        db, sites_service.resolve_site(db, site_id=site_id, viewer=current_user)
    )


@router.post("/{site_id}/versions", response_model=SiteRead)
@limiter.limit("30/minute")
def save_site_version(
    request: Request, site_id: uuid.UUID, body: SiteVersionCreate, db: DB, current_user: CurrentUser
) -> SiteRead:
    """Edit your site in one transaction: name, kind, added and removed sources, contour changes
    and your linked events."""
    site = sites_service.resolve_site(db, site_id=site_id, viewer=None)
    site = sites_service.save_version(db, site=site, user=current_user, body=body)
    return sites_service.build_site_read(db, site)


@router.get("/{site_id}/versions", response_model=SiteVersionList)
@authenticated_read_quota
@limiter.limit("120/minute")
def list_site_versions(
    request: Request,
    response: Response,
    site_id: uuid.UUID,
    db: DB,
    current_user: OptionalUser,
    limit: int = Query(HISTORY_PAGE_SIZE, ge=1),
    cursor: Cursor = None,
) -> SiteVersionList:
    """The site's superseded versions, newest first."""
    site = sites_service.resolve_site(db, site_id=site_id, viewer=current_user)
    size = page_size(limit)
    window = versions_service.list_versions(
        db,
        SiteVersion,
        site.id,
        limit=size,
        cursor=decode_ordinal_cursor(cursor),
    )
    rows = paged(request, response, window, size, lambda r: encode_ordinal_cursor(r.version_no))
    return SiteVersionList(
        items=sites_service.build_version_reads(db, rows),
        total=versions_service.count_versions(db, SiteVersion, site.id),
    )


@router.get("/{site_id}/versions/{version_no}", response_model=SiteVersionRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_site_version(
    request: Request, site_id: uuid.UUID, version_no: int, db: DB, current_user: OptionalUser
) -> SiteVersionRead:
    """One superseded version of a site, by its number."""
    site = sites_service.resolve_site(db, site_id=site_id, viewer=current_user)
    row = sites_service.get_version(db, site_id=site.id, version_no=version_no)
    (read,) = sites_service.build_version_reads(db, [row])
    return read


@router.post(
    "/{site_id}/sources",
    response_model=SiteSourceFiledRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
def file_site_source(
    request: Request, site_id: uuid.UUID, body: SiteSourceCreate, db: DB, current_user: CurrentUser
) -> SiteSourceFiledRead:
    """File a dated satellite source on a site, filing a version."""
    site = sites_service.resolve_site(db, site_id=site_id, viewer=None)
    return sites_service.file_site_source(db, site=site, author=current_user, body=body)


@router.delete("/{site_id}/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def remove_site_source(
    request: Request, site_id: uuid.UUID, source_id: uuid.UUID, db: DB, current_user: CurrentUser
) -> None:
    """Remove a source you filed from the site, filing a version."""
    site = sites_service.resolve_site(db, site_id=site_id, viewer=None)
    sites_service.remove_site_source(db, site=site, user=current_user, source_id=source_id)
