import uuid

from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.event import Event
from app.models.follow import Follow
from app.models.user import User
from app.services.event_filters import published_events, visible_events
from app.services.thumbnails import thumbnail_media_criteria


def follow_user(db: Session, *, follower_id: uuid.UUID, followed_user: User) -> bool:
    """Insert a follow row. Idempotent: returns ``False`` if the edge exists.

    The router resolves the target user and rejects self-follows first.

    Two requests can race past the existence check. The INSERT runs in a
    SAVEPOINT so the loser's ``IntegrityError`` rolls back without poisoning
    the outer transaction (same pattern as ``routers/tags``).
    """
    existing = (
        db.query(Follow)
        .filter(and_(Follow.follower_id == follower_id, Follow.followed_id == followed_user.id))
        .first()
    )
    if existing is not None:
        return False
    try:
        with db.begin_nested():
            db.add(Follow(follower_id=follower_id, followed_id=followed_user.id))
    except IntegrityError:
        return False
    return True


def unfollow_user(db: Session, *, follower_id: uuid.UUID, followed_user: User) -> bool:
    """Delete a follow row. Idempotent: returns ``False`` if no edge exists."""
    follow = (
        db.query(Follow)
        .filter(and_(Follow.follower_id == follower_id, Follow.followed_id == followed_user.id))
        .first()
    )
    if follow is None:
        return False
    db.delete(follow)
    return True


def is_following(db: Session, *, follower_id: uuid.UUID, followed_id: uuid.UUID) -> bool:
    return (
        db.query(Follow)
        .filter(and_(Follow.follower_id == follower_id, Follow.followed_id == followed_id))
        .first()
        is not None
    )


def get_timeline(
    db: Session,
    *,
    user_id: uuid.UUID,
    page: int = 1,
    per_page: int = 20,
) -> dict:
    """Page (by offset) through the published geolocations of followed users.

    Filtered on :func:`services.event_filters.published_events`, the same set
    the analyst's own profile feed serves.

    Returns ``{"items": [(geo, lat, lng), ...], "total": int}``, ordered by
    ``created_at DESC, id DESC``: total and immutable, unlike the nullable,
    editable ``event_date``, so a keyset cursor can key on it. Coordinates
    come from the same SELECT to avoid an N+1.
    """
    followed_ids_stmt = select(Follow.followed_id).where(Follow.follower_id == user_id)
    followed_ids = list(db.execute(followed_ids_stmt).scalars().all())

    if not followed_ids:
        return {"items": [], "total": 0}

    where_clause = and_(Event.owner_id.in_(followed_ids), *visible_events(), published_events())
    total = db.query(func.count(Event.id)).filter(where_clause).scalar() or 0
    window = (
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
        .filter(where_clause)
        .order_by(Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return {"items": window.all(), "total": total}
