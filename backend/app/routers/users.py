import asyncio
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import build_event_list
from app.schemas.collection import CollectionList
from app.schemas.event import PaginatedEvents
from app.schemas.invite_code import (
    SponsoredInviteCodeCreate,
    SponsoredInviteCodeList,
    SponsoredInviteCodeRead,
)
from app.schemas.organization import OrganizationMembershipRead
from app.schemas.preferences import UserPreferencesRead, UserPreferencesUpdate
from app.schemas.user import UserProfile, UserRead, UserStatsRead, UserUpdate, XHandleRead
from app.services import collections as collections_service
from app.services import organizations as organizations_service
from app.services import preferences as preferences_service
from app.services import social, sponsored_invites, user_stats
from app.services import users as users_service
from app.services.pagination import page_size

router = APIRouter()


def _get_live_user_or_404(db: Session, username: str) -> User:
    """Resolve ``username`` to a live ``User`` or 404. Unknown and soft-deleted
    both 404 so the URL space isn't a soft-delete oracle."""
    user = users_service.get_live_by_username(db, username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/me", response_model=UserRead)
@limiter.limit("30/minute")
def update_my_profile(
    request: Request,
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """Edit your own profile.

    ``exclude_unset`` separates omitted (column untouched) from null (clears
    it; empty string normalises to ``None``). ``external_links`` replaces the
    whole JSONB blob, since the form submits the entire panel.
    """
    users_service.apply_profile_update(current_user, body)
    db.commit()
    db.refresh(current_user)
    return current_user


# Ahead of the ``/{username}`` routes so ``/me/avatar`` isn't read as a
# username. Plain ``def`` driving the async service through ``asyncio.run``,
# so the commit stays off the event loop (``engineering.md``, Request
# concurrency).
@router.put("/me/avatar", response_model=UserRead)
@limiter.limit("20/minute")
def set_my_avatar(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """Replace your profile picture with an uploaded image.

    Accepts one JPEG / PNG / WebP, stores a stripped and resized JPEG on our
    own media host (the only thing ``avatar_url`` points at), and deletes the
    picture it replaced.
    """
    try:
        return asyncio.run(users_service.set_avatar(db, owner=current_user, file=file))
    except users_service.AvatarError as exc:
        raise_typed_error(exc, users_service.AVATAR_ERROR_STATUS)


@router.delete("/me/avatar", response_model=UserRead)
@limiter.limit("20/minute")
def delete_my_avatar(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """Drop your profile picture (surfaces fall back to the monogram)."""
    return users_service.clear_avatar(db, owner=current_user)


@router.get("/me/preferences", response_model=UserPreferencesRead)
@limiter.limit("120/minute")
def get_my_preferences(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserPreferencesRead:
    """Your display and notification preferences, each beside its default."""
    return preferences_service.get_preferences(db, user=current_user)


@router.patch("/me/preferences", response_model=UserPreferencesRead)
@limiter.limit("60/minute")
def update_my_preferences(
    request: Request,
    body: UserPreferencesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserPreferencesRead:
    """Change some of your preferences; omitted fields keep their value."""
    result = preferences_service.update_preferences(db, user=current_user, body=body)
    db.commit()
    return result


@router.get("/me/x-handle", response_model=XHandleRead)
@limiter.limit("120/minute")
def get_my_x_handle(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> XHandleRead:
    """The X handle bound to your account. Only an admin links or changes it."""
    return XHandleRead(x_handle=current_user.x_handle)


@router.get("/me/invite-codes", response_model=SponsoredInviteCodeList)
@limiter.limit("120/minute")
def list_my_invite_codes(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SponsoredInviteCodeList:
    """The invite codes you minted, newest first, and your daily quota."""
    return sponsored_invites.list_own(db, sponsor=current_user)


@router.post(
    "/me/invite-codes",
    response_model=SponsoredInviteCodeRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/hour")
def mint_my_invite_code(
    request: Request,
    body: SponsoredInviteCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SponsoredInviteCodeRead:
    """Mint a single-use invite code bound to the invitee's X handle."""
    try:
        return sponsored_invites.mint(db, sponsor=current_user, x_handle=body.x_handle)
    except sponsored_invites.SponsoredInviteError as exc:
        raise_typed_error(exc, sponsored_invites.ERROR_STATUS)


@router.post("/me/invite-codes/{code_id}/revoke", response_model=SponsoredInviteCodeRead)
@limiter.limit("30/hour")
def revoke_my_invite_code(
    request: Request,
    code_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SponsoredInviteCodeRead:
    """Revoke an active invite code you minted. The row stays in your list."""
    try:
        return sponsored_invites.revoke_own(db, sponsor=current_user, code_id=code_id)
    except sponsored_invites.SponsoredInviteError as exc:
        raise_typed_error(exc, sponsored_invites.ERROR_STATUS)


@router.get("/{username}", response_model=UserProfile)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_profile(
    request: Request,
    username: str,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> UserProfile:
    user = _get_live_user_or_404(db, username)
    return social.build_profile(db, user, viewer=current_user)


@router.get("/{username}/stats", response_model=UserStatsRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_stats(
    request: Request,
    username: str,
    db: Session = Depends(get_db),
) -> UserStatsRead:
    """Aggregated shape-of-work stats for a public profile (anonymous, live
    rows only; aggregation lives in ``services/user_stats``)."""
    user = _get_live_user_or_404(db, username)
    return user_stats.get_user_stats(db, user_id=user.id)


@router.get("/{username}/collections", response_model=CollectionList)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_collections(
    request: Request,
    username: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> CollectionList:
    """One analyst's collections, newest first.

    A collection with nothing showable is scaffolding, so readers get the
    non-empty ones and the owner gets all. ``total`` is narrowed too; withheld
    collections are in neither view. Offset-paged, capped at 100 per page.
    """
    user = _get_live_user_or_404(db, username)
    per_page = page_size(per_page)
    rows, total = collections_service.list_owned_collections(
        db,
        owner_id=user.id,
        include_empty=current_user is not None and current_user.id == user.id,
        page=page,
        per_page=per_page,
    )
    return CollectionList(
        items=collections_service.build_collection_reads(db, rows),
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/{username}/organizations", response_model=list[OrganizationMembershipRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_organizations(
    request: Request,
    username: str,
    db: Session = Depends(get_db),
) -> list[OrganizationMembershipRead]:
    """The organizations an analyst belongs to, by name, with their role in each."""
    user = _get_live_user_or_404(db, username)
    return organizations_service.list_memberships(db, user)


@router.post("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def follow_user(
    request: Request,
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Follow another analyst. Idempotent (204, no extra row). Self-follow is
    a 400 (``ck_follows_no_self_follow``)."""
    target = _get_live_user_or_404(db, username)
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    social.follow_user(db, follower_id=current_user.id, followed_user=target)
    db.commit()


@router.delete("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def unfollow_user(
    request: Request,
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Unfollow an analyst. Idempotent (204). A typo username is still a 404
    so the UI can surface it."""
    target = _get_live_user_or_404(db, username)
    social.unfollow_user(db, follower_id=current_user.id, followed_user=target)
    db.commit()


@router.get("/{username}/events", response_model=PaginatedEvents)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_geolocations(
    request: Request,
    username: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1),
    db: Session = Depends(get_db),
):
    """One analyst's published geolocations, newest event date first, capped
    at 100 per page.

    Published, not merely visible: :func:`published_events` narrows to
    ``geolocated``, so detections and rejected rows are never credited. The
    filter applies to the count and the rows, and ``geolocations_count`` on the
    profile counts the same set. The wider live total is ``total_events`` on
    :func:`get_user_stats`.

    Offset-paged: the profile orders by ``occurred_date``, which is nullable and
    editable, so it cannot key a cursor.
    """
    user = _get_live_user_or_404(db, username)
    # Over-asking is clamped; ``ge=1`` keeps a page below 1 from becoming a
    # negative OFFSET (a 500).
    per_page = page_size(per_page)
    rows, total = social.list_published_geolocations(
        db, user_id=user.id, page=page, per_page=per_page
    )
    items = [build_event_list(geo, lat=lat, lng=lng) for geo, lat, lng in rows]
    return PaginatedEvents(items=items, total=total, page=page, per_page=per_page)
