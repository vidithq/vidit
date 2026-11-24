import asyncio
import uuid

from fastapi import APIRouter, File, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.dependencies import DB, CurrentUser, Cursor, OptionalUser
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.collection import CollectionRead
from app.schemas.invite_code import (
    SponsoredInviteCodeCreate,
    SponsoredInviteCodeList,
    SponsoredInviteCodeRead,
)
from app.schemas.organization import OrganizationMembershipRead
from app.schemas.preferences import UserPreferencesRead, UserPreferencesUpdate
from app.schemas.profile import UserProfile
from app.schemas.user import UserRead, UserStatsRead, UserUpdate
from app.services import collections as collections_service
from app.services import organizations as organizations_service
from app.services import preferences as preferences_service
from app.services import social, sponsored_invites, user_stats
from app.services import users as users_service
from app.services.pagination import (
    MAX_PAGE_SIZE,
    decode_cursor,
    encode_cursor,
    page_size,
    paged,
)

router = APIRouter()


def _get_live_user_or_404(db: Session, username: str) -> User:
    """Unknown and soft-deleted both 404 so the URL space isn't a soft-delete oracle."""
    user = users_service.get_live_by_username(db, username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/me", response_model=UserRead)
@limiter.limit("30/minute")
def update_my_profile(
    request: Request, body: UserUpdate, db: DB, current_user: CurrentUser
) -> User:
    """Edit your own profile."""
    users_service.apply_profile_update(current_user, body)
    db.commit()
    return current_user


# Ahead of the ``/{username}`` routes so ``/me/avatar`` isn't read as a
# username. Plain ``def`` driving the async service through ``asyncio.run``,
# so the commit stays off the event loop (``engineering.md``, Request
# concurrency).
@router.put("/me/avatar", response_model=UserRead)
@limiter.limit("20/minute")
def set_my_avatar(
    request: Request, db: DB, current_user: CurrentUser, file: UploadFile = File(...)
) -> User:
    """Replace your profile picture with an uploaded image."""
    return asyncio.run(users_service.set_avatar(db, owner=current_user, file=file))


@router.delete("/me/avatar", response_model=UserRead)
@limiter.limit("20/minute")
def delete_my_avatar(request: Request, db: DB, current_user: CurrentUser) -> User:
    """Drop your profile picture (surfaces fall back to the monogram)."""
    return users_service.clear_avatar(db, owner=current_user)


@router.get("/me/preferences", response_model=UserPreferencesRead)
@limiter.limit("120/minute")
def get_my_preferences(request: Request, db: DB, current_user: CurrentUser) -> UserPreferencesRead:
    """Your display and notification preferences, each beside its default."""
    return preferences_service.get_preferences(db, user=current_user)


@router.patch("/me/preferences", response_model=UserPreferencesRead)
@limiter.limit("60/minute")
def update_my_preferences(
    request: Request, body: UserPreferencesUpdate, db: DB, current_user: CurrentUser
) -> UserPreferencesRead:
    """Change some of your preferences; omitted fields keep their value."""
    result = preferences_service.update_preferences(db, user=current_user, body=body)
    db.commit()
    return result


@router.get("/me/invite-codes", response_model=SponsoredInviteCodeList)
@limiter.limit("120/minute")
def list_my_invite_codes(
    request: Request, db: DB, current_user: CurrentUser
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
    request: Request, body: SponsoredInviteCodeCreate, db: DB, current_user: CurrentUser
) -> SponsoredInviteCodeRead:
    """Mint a single-use invite code bound to the invitee's X handle."""
    return sponsored_invites.mint(db, sponsor=current_user, x_handle=body.x_handle)


@router.post("/me/invite-codes/{invite_code_id}/revoke", response_model=SponsoredInviteCodeRead)
@limiter.limit("30/hour")
def revoke_my_invite_code(
    request: Request, invite_code_id: uuid.UUID, db: DB, current_user: CurrentUser
) -> SponsoredInviteCodeRead:
    """Revoke an active invite code you minted. The row stays in your list."""
    return sponsored_invites.revoke_own(db, sponsor=current_user, invite_code_id=invite_code_id)


@router.get("/{username}", response_model=UserProfile)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_profile(
    request: Request, username: str, db: DB, current_user: OptionalUser
) -> UserProfile:
    user = _get_live_user_or_404(db, username)
    return social.build_profile(
        db,
        user,
        viewer=current_user,
        organizations=organizations_service.list_memberships(db, user),
    )


@router.get("/{username}/stats", response_model=UserStatsRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_stats(request: Request, username: str, db: DB) -> UserStatsRead:
    """Aggregated shape-of-work stats for a public profile."""
    user = _get_live_user_or_404(db, username)
    return user_stats.get_user_stats(db, user_id=user.id)


@router.get("/{username}/collections", response_model=list[CollectionRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_collections(
    request: Request,
    response: Response,
    username: str,
    db: DB,
    current_user: OptionalUser,
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: Cursor = None,
) -> list[CollectionRead]:
    """One analyst's collections, newest first (``Link: rel="next"`` cursor)."""
    user = _get_live_user_or_404(db, username)
    size = page_size(limit)
    window = collections_service.list_owned_collections(
        db,
        owner_id=user.id,
        include_empty=current_user is not None and current_user.id == user.id,
        limit=size,
        cursor=decode_cursor(cursor),
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r.created_at, r.id))
    return collections_service.build_collection_reads(db, rows)


@router.get("/{username}/organizations", response_model=list[OrganizationMembershipRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_organizations(
    request: Request, username: str, db: DB
) -> list[OrganizationMembershipRead]:
    """The organizations an analyst belongs to, by name, with their role in each."""
    user = _get_live_user_or_404(db, username)
    return organizations_service.list_memberships(db, user)


@router.post("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def follow_user(request: Request, username: str, db: DB, current_user: CurrentUser) -> None:
    """Follow another analyst."""
    target = _get_live_user_or_404(db, username)
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    social.follow_user(db, follower_id=current_user.id, followed_user=target)
    db.commit()


@router.delete("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def unfollow_user(request: Request, username: str, db: DB, current_user: CurrentUser) -> None:
    """Unfollow an analyst."""
    target = _get_live_user_or_404(db, username)
    social.unfollow_user(db, follower_id=current_user.id, followed_user=target)
    db.commit()
