"""Approvals of one event: the per-version read and approving the live version."""

import uuid

from fastapi import APIRouter, Query, Request, status

from app.dependencies import DB, CurrentUser, OptionalUser
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import resolve_live_event, resolve_readable_event
from app.schemas.approval import ApprovalCreate, ApprovalList, ApprovalRead
from app.services import approvals, organizations

router = APIRouter()


@router.get("/{geolocation_id}/approvals", response_model=ApprovalList)
@authenticated_read_quota
@limiter.limit("120/minute")
def list_approvals(
    request: Request,
    geolocation_id: uuid.UUID,
    db: DB,
    current_user: OptionalUser,
    version_no: int | None = Query(
        None,
        ge=1,
        description="Defaults to the live version unless reviewer or all_versions is set",
    ),
    reviewer: str | None = Query(None, min_length=1, max_length=50),
    all_versions: bool = Query(False, description="Every version's approvals, oldest first"),
) -> ApprovalList:
    """The approvals of the event: one version's, every version's, or one analyst's across
    versions, and whether you may approve it."""
    geo = resolve_readable_event(db, geolocation_id, current_user)
    if version_no is None and reviewer is None and not all_versions:
        version_no = geo.version_no
    rows = approvals.list_approvals(db, geo=geo, version_no=version_no, reviewer=reviewer)
    return ApprovalList(
        items=[approvals.build_read(row) for row in rows],
        viewer_can_approve=approvals.may_approve(db, geo=geo, user=current_user),
    )


@router.post(
    "/{geolocation_id}/approvals",
    response_model=ApprovalRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("60/minute")
def approve_event(
    request: Request,
    geolocation_id: uuid.UUID,
    body: ApprovalCreate,
    current_user: CurrentUser,
    db: DB,
) -> ApprovalRead:
    """Approve the live version of a published geolocation you are not credited on, as
    yourself or, as one of its members, for an organization."""
    geo = resolve_live_event(db, geolocation_id)
    organization = (
        organizations.get_by_slug(db, body.organization) if body.organization is not None else None
    )
    row = approvals.approve(
        db,
        geo=geo,
        reviewer=current_user,
        version_no=body.version_no,
        organization=organization,
    )
    return approvals.build_read(row)
