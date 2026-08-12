from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.orm import Session, joinedload, selectinload

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.event import Event
from app.models.follow import Follow
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers.events._common import build_event_list
from app.schemas.event import PaginatedEvents
from app.schemas.user import UserProfile, UserRead, UserStatsRead, UserUpdate
from app.services import social, user_stats
from app.services.pagination import page_size
from app.services.thumbnails import thumbnail_media_criteria

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


@router.patch("/me", response_model=UserRead)
@limiter.limit("30/minute")
def update_my_profile(
    request: Request,
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
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_profile(
    request: Request,
    username: str,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> UserProfile:
    user = _get_live_user_or_404(db, username)

    geolocations_count = (
        db.query(Event).filter(Event.owner_id == user.id, Event.deleted_at.is_(None)).count()
    )

    followers_count = db.query(Follow).filter(Follow.followed_id == user.id).count()
    following_count = db.query(Follow).filter(Follow.follower_id == user.id).count()

    is_following = False
    if current_user is not None and current_user.id != user.id:
        is_following = social.is_following(db, follower_id=current_user.id, followed_id=user.id)

    return UserProfile(
        id=user.id,
        username=user.username,
        bio=user.bio,
        avatar_url=user.avatar_url,
        external_links=user.external_links or {},
        created_at=user.created_at,
        geolocations_count=geolocations_count,
        followers_count=followers_count,
        following_count=following_count,
        is_following=is_following,
    )


@router.get("/{username}/stats", response_model=UserStatsRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_user_stats(
    request: Request,
    username: str,
    db: Session = Depends(get_db),
) -> UserStatsRead:
    """Aggregated shape-of-work stats for a public profile.

    Anonymous like the rest of the profile read surface; live rows only.
    All aggregation lives in ``services/user_stats``.
    """
    user = _get_live_user_or_404(db, username)
    return user_stats.get_user_stats(db, user_id=user.id)


@router.post("/{username}/follow", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def follow_user(
    request: Request,
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
@limiter.limit("60/minute")
def unfollow_user(
    request: Request,
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
    """One analyst's events, newest event date first, capped at 100 per page.

    Offset-paged rather than cursor-paged: the ordering the profile reads by
    is ``event_date``, which is nullable and editable and so cannot key a
    cursor, and one analyst's output is not the enumeration surface the
    catalog list is. The pager's page is bounded either way.
    """
    user = _get_live_user_or_404(db, username)

    # Over-asking is clamped, not rejected; ``ge=1`` above keeps a page below 1
    # from reaching Postgres as a negative OFFSET (a 500).
    per_page = page_size(per_page)

    total = db.query(Event).filter(Event.owner_id == user.id, Event.deleted_at.is_(None)).count()

    rows = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
        )
        # Loader choice: see the note on ``list_detections`` in
        # ``routers/events/read.py``.
        .options(
            joinedload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
        )
        .filter(Event.owner_id == user.id, Event.deleted_at.is_(None))
        # ``event_date`` alone is neither unique nor non-null, so an OFFSET
        # walk over it lets Postgres return tied rows in any order it likes
        # and a page can repeat a row the previous one already served, or skip
        # one. ``created_at, id`` breaks every tie and makes the ordering
        # total.
        .order_by(Event.event_date.desc(), Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    items = [build_event_list(geo, lat=lat, lng=lng) for geo, lat, lng in rows]

    return PaginatedEvents(items=items, total=total, page=page, per_page=per_page)
