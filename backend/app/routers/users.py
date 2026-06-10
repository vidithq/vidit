from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.orm import Session, joinedload, selectinload

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.follow import Follow
from app.models.geolocation import Geolocation
from app.models.user import User
from app.schemas.geolocation import GeolocationList, PaginatedGeolocations
from app.schemas.user import UserProfile, UserRead, UserUpdate
from app.services import social

router = APIRouter()


def _get_live_user_or_404(db: Session, username: str) -> User:
    """Resolve ``username`` to a live (non-soft-deleted) ``User`` or 404.

    Four endpoints share this lookup. Unknown and soft-deleted analysts
    both 404 with ``User not found`` — collapsing the two keeps the URL
    space from being a soft-delete oracle.
    """
    user = db.query(User).filter(User.username == username, User.deleted_at.is_(None)).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _profile_payload(
    user: User,
    geolocations_count: int,
    followers_count: int,
    following_count: int,
    is_following: bool,
) -> UserProfile:
    return UserProfile(
        id=user.id,
        username=user.username,
        is_trusted=user.is_trusted,
        trust_reason=user.trust_reason,
        bio=user.bio,
        avatar_url=user.avatar_url,
        external_links=user.external_links or {},
        created_at=user.created_at,
        geolocations_count=geolocations_count,
        followers_count=followers_count,
        following_count=following_count,
        is_following=is_following,
    )


@router.patch("/me", response_model=UserRead)
def update_my_profile(
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """Edit your own profile.

    Distinguishes "field omitted" from "field set to null" via
    ``exclude_unset``: omitting leaves the column alone, explicit null (or
    empty string, normalised to ``None`` by the schema) clears it.
    ``external_links`` replaces the whole JSONB blob — the edit form
    submits the entire panel at once, so wholesale replace fits the UI.
    """
    update_data = body.model_dump(exclude_unset=True)
    if "bio" in update_data:
        current_user.bio = update_data["bio"]
    if "avatar_url" in update_data:
        current_user.avatar_url = update_data["avatar_url"]
    if "external_links" in update_data:
        links = update_data["external_links"]
        # ``None`` clears every platform; a partial dict (e.g. ``{x:...}``)
        # drops every other platform too — the "wholesale replace"
        # semantics. Per-platform ``None`` values are stripped so the
        # stored JSONB stays sparse.
        if links is None:
            current_user.external_links = {}
        else:
            current_user.external_links = {k: v for k, v in links.items() if v is not None}
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/{username}", response_model=UserProfile)
def get_user_profile(
    username: str,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> UserProfile:
    user = _get_live_user_or_404(db, username)

    count = (
        db.query(Geolocation)
        .filter(Geolocation.author_id == user.id, Geolocation.deleted_at.is_(None))
        .count()
    )

    followers_count = db.query(Follow).filter(Follow.followed_id == user.id).count()
    following_count = db.query(Follow).filter(Follow.follower_id == user.id).count()

    is_following = False
    if current_user is not None and current_user.id != user.id:
        is_following = social.is_following(db, follower_id=current_user.id, followed_id=user.id)

    return _profile_payload(
        user,
        geolocations_count=count,
        followers_count=followers_count,
        following_count=following_count,
        is_following=is_following,
    )


@router.post("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
def follow_user(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Follow another analyst. Idempotent: re-following an already-followed
    analyst returns 204 with no extra row. Self-follow is rejected with 400
    (matching the DB-level ``ck_follows_no_self_follow`` constraint)."""
    target = _get_live_user_or_404(db, username)
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    social.follow_user(db, follower_id=current_user.id, followed_user=target)
    db.commit()


@router.delete("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_user(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Unfollow an analyst. Idempotent: unfollowing someone you don't currently
    follow returns 204. A typo username still gets a 404 so the UI can surface
    the error instead of silently no-op'ing."""
    target = _get_live_user_or_404(db, username)
    social.unfollow_user(db, follower_id=current_user.id, followed_user=target)
    db.commit()


@router.get("/{username}/geolocations", response_model=PaginatedGeolocations)
def get_user_geolocations(
    username: str,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
):
    user = _get_live_user_or_404(db, username)

    if per_page > 100:
        per_page = 100

    total = (
        db.query(Geolocation)
        .filter(Geolocation.author_id == user.id, Geolocation.deleted_at.is_(None))
        .count()
    )

    rows = (
        db.query(
            Geolocation,
            ST_Y(Geolocation.location).label("lat"),
            ST_X(Geolocation.location).label("lng"),
        )
        # ``selectinload`` for tags — a many-to-many ``joinedload`` would
        # row-multiply against ``LIMIT`` and silently truncate the page.
        .options(joinedload(Geolocation.author), selectinload(Geolocation.tags))
        .filter(Geolocation.author_id == user.id, Geolocation.deleted_at.is_(None))
        .order_by(Geolocation.event_date.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    items = [
        GeolocationList(
            id=geo.id,
            title=geo.title,
            lat=lat,
            lng=lng,
            event_date=geo.event_date,
            is_demo=geo.is_demo,
            author=geo.author,
            tags=geo.tags,
        )
        for geo, lat, lng in rows
    ]

    return PaginatedGeolocations(items=items, total=total, page=page, per_page=per_page)
