"""Approval requests on one event: the open list, the target picker, sending and declining.

Business rules live in ``services/approval_requests``; this module maps its typed errors.
"""

import uuid
from typing import NoReturn

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import resolve_live_event
from app.schemas.approval_request import (
    ApprovalRequestCreate,
    ApprovalRequestRead,
    ApprovalRequestTargetList,
)
from app.services import approval_requests
from app.services.approval_requests import APPROVAL_REQUEST_ERROR_STATUS, ApprovalRequestError

router = APIRouter()


def _raise(exc: ApprovalRequestError) -> NoReturn:
    raise_typed_error(exc, APPROVAL_REQUEST_ERROR_STATUS)


@router.get("/{geolocation_id}/approval-requests", response_model=list[ApprovalRequestRead])
@limiter.limit("120/minute")
def list_approval_requests(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    q: str = Query(
        "", max_length=50, description="Narrows by a substring of the username or organization"
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApprovalRequestTargetList:
    """Analysts and organizations you can ask to approve this event now (geolocators only)."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        return approval_requests.eligible_targets(db, geo=geo, requester=current_user, query=q)
    except ApprovalRequestError as exc:
        _raise(exc)


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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApprovalRequestRead:
    """Ask an analyst or an organization to approve the live version of a published event you
    geolocated."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        row = approval_requests.request_approval(
            db,
            geo=geo,
            requester=current_user,
            username=body.username,
            organization=body.organization,
        )
    except ApprovalRequestError as exc:
        _raise(exc)
    return approval_requests.build_read(row)


@router.post(
    "/{geolocation_id}/approval-requests/{request_id}/decline", response_model=ApprovalRequestRead
)
@limiter.limit("60/minute")
def decline_approval_request(
    request: Request,
    geolocation_id: uuid.UUID,
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApprovalRequestRead:
    """Decline a approval request addressed to you, or to an organization you manage."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        row = approval_requests.decline(db, geo=geo, request_id=request_id, user=current_user)
    except ApprovalRequestError as exc:
        _raise(exc)
    return approval_requests.build_read(row)
