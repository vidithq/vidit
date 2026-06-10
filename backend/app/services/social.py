import uuid

from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.follow import Follow
from app.models.geolocation import Geolocation
from app.models.user import User


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
    """Page through geolocations authored by users that ``user_id`` follows.

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
        Geolocation.author_id.in_(followed_ids),
        Geolocation.deleted_at.is_(None),
    )
    total = db.query(func.count(Geolocation.id)).filter(where_clause).scalar() or 0
    rows = (
        db.query(
            Geolocation,
            ST_Y(Geolocation.location).label("lat"),
            ST_X(Geolocation.location).label("lng"),
        )
        # ``selectinload`` for tags — a many-to-many ``joinedload`` would
        # row-multiply against ``LIMIT`` and silently truncate the page.
        # ``joinedload`` is safe for the author (many-to-one, no inflation).
        .options(joinedload(Geolocation.author), selectinload(Geolocation.tags))
        .filter(where_clause)
        .order_by(Geolocation.event_date.desc(), Geolocation.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return {"items": rows, "total": total}
