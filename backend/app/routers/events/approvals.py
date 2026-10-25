"""Approvals of one event: the per-version read and approving the live version.

Business rules live in ``services/approvals``; this module maps its typed errors.
"""

import uuid
from typing import NoReturn

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import resolve_live_event, resolve_readable_event
from app.schemas.approval import ApprovalCreate, ApprovalList, ApprovalRead
from app.services import approvals, organizations
from app.services.approvals import APPROVAL_ERROR_STATUS, ApprovalError

router = APIRouter()


def _raise(exc: ApprovalError) -> NoReturn:
    raise_typed_error(exc, APPROVAL_ERROR_STATUS)


@router.get("/{geolocation_id}/approvals", response_model=ApprovalList)
@authenticated_read_quota
@limiter.limit("120/minute")
def list_approvals(
    request: Request,
    geolocation_id: uuid.UUID,
    version_no: int | None = Query(
        None,
        ge=1,
        description="Defaults to the live version unless reviewer or all_versions is set",
    ),
    reviewer: str | None = Query(None, min_length=1, max_length=50),
    all_versions: bool = Query(False, description="Every version's approvals, oldest first"),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> ApprovalList:
    """The approvals of the event: one version's, every version's, or one analyst's across
    versions, and whether you may approve it."""
    geo = resolve_readable_event(db, geolocation_id, current_user)
    if version_no is None and reviewer is None and not all_versions:
        version_no = geo.version_no
    rows = approvals.list_approvals(db, geo=geo, version_no=version_no, reviewer=reviewer)
    return ApprovalList(
        items=[approvals.build_read(row, live_version=geo.version_no) for row in rows],
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApprovalRead:
    """Approve the live version of a published geolocation you are not credited on, as
    yourself or, as one of its members, for an organization."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        organization = (
            organizations.get_by_slug(db, body.organization)
            if body.organization is not None
            else None
        )
    except organizations.OrganizationError as exc:
        raise_typed_error(exc, organizations.ORGANIZATION_ERROR_STATUS)
    try:
        row = approvals.approve(
            db,
            geo=geo,
            reviewer=current_user,
            version_no=body.version_no,
            organization=organization,
        )
    except ApprovalError as exc:
        _raise(exc)
    return approvals.build_read(row, live_version=geo.version_no)
