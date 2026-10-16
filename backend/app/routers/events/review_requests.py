"""Review requests on one event: the open list, the target picker, sending and declining.

Business rules live in ``services/review_requests``; this module maps its typed errors.
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
from app.schemas.review_request import (
    ReviewRequestCreate,
    ReviewRequestRead,
    ReviewRequestTargetList,
)
from app.services import review_requests
from app.services.review_requests import REVIEW_REQUEST_ERROR_STATUS, ReviewRequestError

router = APIRouter()


def _raise(exc: ReviewRequestError) -> NoReturn:
    raise_typed_error(exc, REVIEW_REQUEST_ERROR_STATUS)


@router.get("/{geolocation_id}/review-requests", response_model=list[ReviewRequestRead])
@limiter.limit("120/minute")
def list_review_requests(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ReviewRequestRead]:
    """Open review requests on this event: all of them for its geolocators, those addressed to
    you or to an organization you administer otherwise."""
    geo = resolve_live_event(db, geolocation_id)
    rows = review_requests.list_open(db, geo=geo, viewer=current_user)
    return [review_requests.build_read(row) for row in rows]


@router.get("/{geolocation_id}/review-request-targets", response_model=ReviewRequestTargetList)
@limiter.limit("120/minute")
def list_review_request_targets(
    request: Request,
    geolocation_id: uuid.UUID,
    q: str = Query(
        "", max_length=50, description="Narrows by a substring of the username or organization"
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReviewRequestTargetList:
    """Analysts and organizations you can ask to review this event now (geolocators only)."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        return review_requests.eligible_targets(db, geo=geo, requester=current_user, query=q)
    except ReviewRequestError as exc:
        _raise(exc)


@router.post(
    "/{geolocation_id}/review-requests",
    response_model=ReviewRequestRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/hour")
def create_review_request(
    request: Request,
    geolocation_id: uuid.UUID,
    body: ReviewRequestCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReviewRequestRead:
    """Ask an analyst or an organization to review the live version of a published event you
    geolocated."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        row = review_requests.request_review(
            db,
            geo=geo,
            requester=current_user,
            username=body.username,
            organization=body.organization,
        )
    except ReviewRequestError as exc:
        _raise(exc)
    return review_requests.build_read(row)


@router.post(
    "/{geolocation_id}/review-requests/{request_id}/decline", response_model=ReviewRequestRead
)
@limiter.limit("60/minute")
def decline_review_request(
    request: Request,
    geolocation_id: uuid.UUID,
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReviewRequestRead:
    """Decline a review request addressed to you, or to an organization you administer."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        row = review_requests.decline(db, geo=geo, request_id=request_id, user=current_user)
    except ReviewRequestError as exc:
        _raise(exc)
    return review_requests.build_read(row)
