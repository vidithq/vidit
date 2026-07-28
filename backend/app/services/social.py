import uuid

from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.event import Event
from app.models.follow import Follow
from app.models.user import User
from app.services.thumbnails import thumbnail_media_criteria


def follow_user(db: Session, *, follower_id: uuid.UUID, followed_user: User) -> bool:
    """Insert a follow row. Idempotent: returns ``False`` if the edge exists.

    The router resolves the target user (and enforces ``follower_id !=
    followed_user.id`` + the soft-delete filter) before calling.

    Two requests can race past the existence check; only one INSERT wins,
    the loser hits the composite-PK violation on flush. Staging the INSERT
    in a SAVEPOINT lets that ``IntegrityError`` roll back without poisoning
    the outer transaction, so the loser sees the same idempotent ``False``
    instead of a 500 that would break advertised idempotency.
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


def get_timeline(db: Session, *, user_id: uuid.UUID, page: int = 1, per_page: int = 20) -> dict:
    """Page through events owned by users that ``user_id`` follows.

    Returns ``{"items": [(geo, lat, lng), ...], "total": int}``, ordered by
    event date (then created_at as tiebreaker), newest first — matching the
    rest of the read surface. Coordinates land in the same SELECT via
    ``ST_X / ST_Y`` so the router avoids an N+1 fetching them per row.
    """
    followed_ids_stmt = select(Follow.followed_id).where(Follow.follower_id == user_id)
    followed_ids = list(db.execute(followed_ids_stmt).scalars().all())

    if not followed_ids:
        return {"items": [], "total": 0}

    where_clause = and_(
        Event.owner_id.in_(followed_ids),
        Event.deleted_at.is_(None),
    )
    total = db.query(func.count(Event.id)).filter(where_clause).scalar() or 0
    rows = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
        )
        # ``selectinload`` for tags + media: a many-to-many / one-to-many
        # ``joinedload`` would row-multiply against ``LIMIT`` and silently
        # truncate the page.
        # ``joinedload`` is safe for the owner (many-to-one, no inflation).
        .options(
            joinedload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
        )
        .filter(where_clause)
        .order_by(Event.event_date.desc(), Event.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {"items": rows, "total": total}
