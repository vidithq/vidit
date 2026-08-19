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

    The router resolves the target user (and enforces ``follower_id !=
    followed_user.id`` + the soft-delete filter) before calling.

    The canonical SAVEPOINT-idempotency note, shared by ``routers/tags``:
    two requests race past the existence check, only one INSERT wins, and the loser hits the uniqueness violation
    on flush. Staging the INSERT in a SAVEPOINT lets that ``IntegrityError``
    roll back without poisoning the outer transaction, so the loser gets the
    advertised idempotent answer instead of a 500.
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
    """Page through the published geolocations of the users ``user_id`` follows.

    Filtered on :func:`services.event_filters.published_events` beside the
    visibility pair, so the feed carries what a followed analyst stood behind
    and nothing else: a detection they have not vouched for is machine output,
    and a geolocation they retracted is a claim taken back. Both leave the feed
    the moment their status says so, which is the same set the analyst's own
    profile feed serves.

    Returns ``{"items": [(geo, lat, lng), ...], "total": int}``, ordered by
    ``created_at DESC, id DESC``: submission order, the ordering the
    rest of the read surface walks and the only one on this table that is
    total and immutable, so the keyset cursor can key on it. ``event_date`` is
    nullable and editable, so it cannot. Coordinates land in the same SELECT
    via ``ST_X / ST_Y`` so the router avoids an N+1 fetching them per row.

    ``page`` walks by offset.
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
        # Loader choice: see the note on ``list_detections`` in
        # ``routers/events/read.py``.
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
