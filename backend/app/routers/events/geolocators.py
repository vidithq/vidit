"""Shared geolocation credit on one event: invitations, answers and removals."""

import uuid

from fastapi import APIRouter, Request, status

from app.dependencies import DB, CurrentUser
from app.ratelimit import limiter
from app.routers.events._common import resolve_live_event
from app.schemas.event import GeolocatorInviteCreate, GeolocatorInviteRead
from app.services import geolocator_credit

router = APIRouter()


@router.get("/{geolocation_id}/geolocator-invites", response_model=list[GeolocatorInviteRead])
@limiter.limit("120/minute")
def list_geolocator_invites(
    request: Request, geolocation_id: uuid.UUID, current_user: CurrentUser, db: DB
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
    current_user: CurrentUser,
    db: DB,
):
    """Invite an analyst to share this published event's credit (owner only)."""
    geo = resolve_live_event(db, geolocation_id)
    return geolocator_credit.invite(db, geo=geo, owner=current_user, username=body.username)


@router.delete(
    "/{geolocation_id}/geolocator-invites/{username}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("30/hour")
def withdraw_geolocator_invite(
    request: Request, geolocation_id: uuid.UUID, username: str, current_user: CurrentUser, db: DB
) -> None:
    """Withdraw a pending invitation (owner only)."""
    geo = resolve_live_event(db, geolocation_id)
    geolocator_credit.withdraw(db, geo=geo, owner=current_user, username=username)


@router.post("/{geolocation_id}/geolocator-invites/accept", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def accept_geolocator_invite(
    request: Request, geolocation_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    """Accept your invitation: you join this event's geolocators."""
    geo = resolve_live_event(db, geolocation_id)
    geolocator_credit.accept(db, geo=geo, user=current_user)


@router.post("/{geolocation_id}/geolocator-invites/decline", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def decline_geolocator_invite(
    request: Request, geolocation_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> None:
    """Decline your invitation."""
    geo = resolve_live_event(db, geolocation_id)
    geolocator_credit.decline(db, geo=geo, user=current_user)


@router.delete(
    "/{geolocation_id}/geolocators/{username}",
    status_code=status.HTTP_204_NO_CONTENT,
)
@limiter.limit("60/minute")
def remove_geolocator(
    request: Request, geolocation_id: uuid.UUID, username: str, current_user: CurrentUser, db: DB
) -> None:
    """Take a co-geolocator's credit off this event: the owner removes one, or you leave."""
    geo = resolve_live_event(db, geolocation_id)
    geolocator_credit.remove(db, geo=geo, actor=current_user, username=username)
