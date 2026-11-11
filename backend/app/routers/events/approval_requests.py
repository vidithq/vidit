"""Approval requests on one event: the open list, the target picker, sending and declining."""

import uuid

from fastapi import APIRouter, Query, Request, status

from app.dependencies import DB, CurrentUser
from app.ratelimit import limiter
from app.routers.events._common import resolve_live_event
from app.schemas.approval_request import (
    ApprovalRequestCreate,
    ApprovalRequestRead,
    ApprovalRequestTargetList,
)
from app.services import approval_requests

router = APIRouter()


@router.get("/{geolocation_id}/approval-requests", response_model=list[ApprovalRequestRead])
@limiter.limit("120/minute")
def list_approval_requests(
    request: Request, geolocation_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[ApprovalRequestRead]:
    """Open approval requests on this event: all of them for its geolocators, those addressed to
    you or to an organization you manage otherwise."""
    geo = resolve_live_event(db, geolocation_id)
    rows = approval_requests.list_open(db, geo=geo, viewer=current_user)
    return [approval_requests.build_read(row) for row in rows]


@router.get("/{geolocation_id}/approval-request-targets", response_model=ApprovalRequestTargetList)
@limiter.limit("120/minute")
def list_approval_request_targets(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    q: str = Query(
        "", max_length=50, description="Narrows by a substring of the username or organization"
    ),
) -> ApprovalRequestTargetList:
    """Analysts and organizations you can ask to approve this event now (geolocators only)."""
    geo = resolve_live_event(db, geolocation_id)
    return approval_requests.eligible_targets(db, geo=geo, requester=current_user, query=q)


@router.post(
    "/{geolocation_id}/approval-requests",
    response_model=ApprovalRequestRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/hour")
def create_approval_request(
    request: Request,
    geolocation_id: uuid.UUID,
    body: ApprovalRequestCreate,
    current_user: CurrentUser,
    db: DB,
) -> ApprovalRequestRead:
    """Ask an analyst or an organization to approve the live version of a published event you
    geolocated."""
    geo = resolve_live_event(db, geolocation_id)
    row = approval_requests.request_approval(
        db,
        geo=geo,
        requester=current_user,
        username=body.username,
        organization=body.organization,
    )
    return approval_requests.build_read(row)


@router.post(
    "/{geolocation_id}/approval-requests/{request_id}/decline", response_model=ApprovalRequestRead
)
@limiter.limit("60/minute")
def decline_approval_request(
    request: Request,
    geolocation_id: uuid.UUID,
    request_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> ApprovalRequestRead:
    """Decline an approval request addressed to you, or to an organization you belong to."""
    geo = resolve_live_event(db, geolocation_id)
    row = approval_requests.decline(db, geo=geo, request_id=request_id, user=current_user)
    return approval_requests.build_read(row)
