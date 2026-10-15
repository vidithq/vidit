"""Shared geolocation credit on one event: invitations, answers and removals.

Business rules live in ``services/geolocator_credit``; this module maps its typed errors.
"""

import uuid
from typing import NoReturn

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import resolve_live_event
from app.schemas.event import GeolocatorInviteCreate, GeolocatorInviteRead
from app.services import geolocator_credit
from app.services.geolocator_credit import GEOLOCATOR_CREDIT_ERROR_STATUS, GeolocatorCreditError

router = APIRouter()


def _raise(exc: GeolocatorCreditError) -> NoReturn:
    raise_typed_error(exc, GEOLOCATOR_CREDIT_ERROR_STATUS)


@router.get("/{geolocation_id}/geolocator-invites", response_model=list[GeolocatorInviteRead])
@limiter.limit("120/minute")
def list_geolocator_invites(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Pending invitations to share this event's credit: all of them for the owner, your own
    otherwise."""
    geo = resolve_live_event(db, geolocation_id)
    return geolocator_credit.list_invites(db, geo=geo, viewer=current_user)


@router.post(
    "/{geolocation_id}/geolocator-invites",
    response_model=GeolocatorInviteRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/hour")
def invite_geolocator(
    request: Request,
    geolocation_id: uuid.UUID,
    body: GeolocatorInviteCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invite an analyst to share this published event's credit (owner only)."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        return geolocator_credit.invite(db, geo=geo, owner=current_user, username=body.username)
    except GeolocatorCreditError as exc:
        _raise(exc)


@router.delete(
    "/{geolocation_id}/geolocator-invites/{username}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("60/minute")
def withdraw_geolocator_invite(
    request: Request,
    geolocation_id: uuid.UUID,
    username: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Withdraw a pending invitation (owner only)."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        geolocator_credit.withdraw(db, geo=geo, owner=current_user, username=username)
    except GeolocatorCreditError as exc:
        _raise(exc)


@router.post("/{geolocation_id}/geolocator-invites/accept", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def accept_geolocator_invite(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Accept your invitation: you join this event's geolocators."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        geolocator_credit.accept(db, geo=geo, user=current_user)
    except GeolocatorCreditError as exc:
        _raise(exc)


@router.post("/{geolocation_id}/geolocator-invites/decline", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def decline_geolocator_invite(
    request: Request,
    geolocation_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Decline your invitation."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        geolocator_credit.decline(db, geo=geo, user=current_user)
    except GeolocatorCreditError as exc:
        _raise(exc)


@router.delete(
    "/{geolocation_id}/geolocators/{username}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("60/minute")
def remove_geolocator(
    request: Request,
    geolocation_id: uuid.UUID,
    username: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Take a co-geolocator's credit off this event: the owner removes one, or you leave."""
    geo = resolve_live_event(db, geolocation_id)
    try:
        geolocator_credit.remove(db, geo=geo, actor=current_user, username=username)
    except GeolocatorCreditError as exc:
        _raise(exc)
