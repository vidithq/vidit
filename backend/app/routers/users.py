import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy.orm import Session, joinedload, selectinload

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.event import Event
from app.models.follow import Follow
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
from app.routers.events._common import build_event_list
from app.schemas.collection import CollectionList
from app.schemas.event import PaginatedEvents
from app.schemas.user import UserProfile, UserRead, UserStatsRead, UserUpdate
from app.services import collections as collections_service
from app.services import social, user_stats
from app.services import users as users_service
from app.services.event_filters import published_events, visible_events
from app.services.pagination import page_size
from app.services.thumbnails import thumbnail_media_criteria

router = APIRouter()


def _get_live_user_or_404(db: Session, username: str) -> User:
    """Resolve ``username`` to a live ``User`` or 404. Unknown and soft-deleted
    both 404 so the URL space isn't a soft-delete oracle."""
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

    ``exclude_unset`` separates omitted (column untouched) from null (clears
    it; empty string normalises to ``None``). ``external_links`` replaces the
    whole JSONB blob, since the form submits the entire panel.
    """
    update_data = body.model_dump(exclude_unset=True)
    if "bio" in update_data:
        current_user.bio = update_data["bio"]
    if "external_links" in update_data:
        links = update_data["external_links"]
        # ``None`` or a partial dict replaces wholesale; per-platform ``None``
        # values are stripped so the JSONB stays sparse.
        if links is None:
            current_user.external_links = {}
        else:
            current_user.external_links = {k: v for k, v in links.items() if v is not None}
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
        return asyncio.run(users_service.set_avatar(db, user=current_user, file=file))
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
    return users_service.clear_avatar(db, user=current_user)


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

    # Published work, not everything owned: the profile's headline number and
    # the size of the Recent submissions block and the coverage split's
    # ``geolocated`` leg. Counting detections made the page contradict itself.
    # Same predicate as the feed below. The wider ``geolocated`` + ``detected``
    # figure is ``total_events`` on ``GET /users/{username}/stats``.
    geolocations_count = (
        db.query(Event)
        .filter(Event.owner_id == user.id, *visible_events(), published_events())
        .count()
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

    Offset-paged: the profile orders by ``event_date``, which is nullable and
    editable, so it cannot key a cursor.
    """
    user = _get_live_user_or_404(db, username)

    # Over-asking is clamped; ``ge=1`` keeps a page below 1 from becoming a
    # negative OFFSET (a 500).
    per_page = page_size(per_page)

    owned_and_published = (Event.owner_id == user.id, *visible_events(), published_events())

    total = db.query(Event).filter(*owned_and_published).count()

    rows = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
        )
        # Loader choice: see ``list_detections`` in ``routers/events/read.py``.
        .options(
            joinedload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
        )
        .filter(*owned_and_published)
        # ``event_date`` is neither unique nor non-null, so ties could repeat or
        # skip rows across OFFSET pages; ``created_at, id`` makes it total.
        .order_by(Event.event_date.desc(), Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    items = [build_event_list(geo, lat=lat, lng=lng) for geo, lat, lng in rows]

    return PaginatedEvents(items=items, total=total, page=page, per_page=per_page)
