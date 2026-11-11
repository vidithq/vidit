import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import Row, Select, and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, aliased

from app.models.event import Event, feed_at
from app.models.follow import Follow
from app.models.user import User
from app.schemas.user import UserProfile
from app.services import notifications
from app.services.event_filters import (
    EventFilters,
    date_histogram,
    live_detections,
    open_requests,
    published_credited_to,
    published_events,
    visible_events,
)
from app.services.geolocator_credit import CARD_LOADS
from app.services.pagination import keyset_before

FeedScope = Literal["following", "all"]


def follow_user(db: Session, *, follower_id: uuid.UUID, followed_user: User) -> bool:
    """Two requests can race past the existence check. The INSERT runs in a SAVEPOINT so the
    loser's ``IntegrityError`` rolls back without poisoning the outer transaction."""
    if is_following(db, follower_id=follower_id, followed_id=followed_user.id):
        return False
    try:
        with db.begin_nested():
            db.add(Follow(follower_id=follower_id, followed_id=followed_user.id))
    except IntegrityError:
        return False
    notifications.notify_new_follower(db, follower_id=follower_id, followed_id=followed_user.id)
    return True


def unfollow_user(db: Session, *, follower_id: uuid.UUID, followed_user: User) -> bool:
    follow = db.get(Follow, (follower_id, followed_user.id))
    if follow is None:
        return False
    db.delete(follow)
    return True


def is_following(db: Session, *, follower_id: uuid.UUID, followed_id: uuid.UUID) -> bool:
    return db.get(Follow, (follower_id, followed_id)) is not None


def is_mutual_follow(db: Session, *, a_id: uuid.UUID, b_id: uuid.UUID) -> bool:
    return is_following(db, follower_id=a_id, followed_id=b_id) and is_following(
        db, follower_id=b_id, followed_id=a_id
    )


def mutual_follow_ids(user_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """The ids of every analyst ``user_id`` follows and who follows them back."""
    back = aliased(Follow)
    return (
        select(Follow.followed_id)
        .join(
            back,
            and_(back.follower_id == Follow.followed_id, back.followed_id == Follow.follower_id),
        )
        .where(Follow.follower_id == user_id)
    )


def _feed_rows(
    db: Session,
    *columns: Any,
    user_id: uuid.UUID,
    scope: FeedScope,
    filters: EventFilters,
) -> SAQuery:
    """``columns`` of the rows the feed lists for ``scope`` and ``filters``, unordered
    (see :func:`get_feed`)."""
    if scope == "following":
        followed = select(Follow.followed_id).where(Follow.follower_id == user_id)
        legs = or_(
            published_credited_to(followed),
            and_(open_requests(), Event.owner_id.in_(followed)),
            and_(live_detections(), Event.owner_id.in_(followed)),
        )
    else:
        legs = or_(published_events(), open_requests(), live_detections())
    return filters.apply(db.query(*columns).filter(legs), view=None)


def get_feed(
    db: Session,
    *,
    user_id: uuid.UUID,
    scope: FeedScope,
    size: int,
    filters: EventFilters,
    cursor: tuple[datetime, uuid.UUID] | None = None,
) -> list[Row[tuple[Event, datetime]]]:
    """One window of the feed, over-fetched by one row for ``pagination.paged``.

    An open request's owner is its requester: ownership moves only when a request is
    geolocated. A detection's owner is the analyst whose post was imported. ``feed_at DESC, id
    DESC`` is a total order over the three kinds, so a keyset walk neither repeats nor skips a
    row.
    """
    key = feed_at()
    query = _feed_rows(
        db,
        Event,
        key.label("feed_at"),
        user_id=user_id,
        scope=scope,
        filters=filters,
    ).options(*CARD_LOADS)
    if cursor is not None:
        query = query.filter(keyset_before(key, Event.id, cursor))
    return query.order_by(key.desc(), Event.id.desc()).limit(size + 1).all()


def get_feed_dates(
    db: Session,
    *,
    user_id: uuid.UUID,
    scope: FeedScope,
    filters: EventFilters,
) -> dict[str, Any]:
    """The rows :func:`get_feed` walks for ``scope`` and ``filters``, counted per day by
    :func:`services.event_filters.date_histogram`."""
    return date_histogram(
        lambda window: _feed_rows(db, Event.id, user_id=user_id, scope=scope, filters=window),
        filters,
    )


def build_profile(db: Session, user: User, *, viewer: User | None) -> UserProfile:
    """The public profile of ``user`` as ``viewer`` reads it.

    ``geolocations_count`` counts the published work credited to them, the set
    :func:`list_published_geolocations` serves, not everything they own: counting detections made
    the page contradict itself. The wider ``geolocated`` + ``detected`` figure is
    ``total_events`` on ``GET /users/{username}/stats``.
    """
    geolocations_count = (
        db.query(Event).filter(published_credited_to([user.id]), *visible_events()).count()
    )
    followers_count = db.query(Follow).filter(Follow.followed_id == user.id).count()
    following_count = db.query(Follow).filter(Follow.follower_id == user.id).count()
    following = (
        viewer is not None
        and viewer.id != user.id
        and is_following(db, follower_id=viewer.id, followed_id=user.id)
    )
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
        is_following=following,
    )


def list_published_geolocations(
    db: Session, *, user_id: uuid.UUID, page: int, per_page: int
) -> tuple[list[Event], int]:
    """One offset page of the published geolocations credited to ``user_id``, newest event date
    first, and their total."""
    credited_and_published = (published_credited_to([user_id]), *visible_events())
    total = db.query(Event).filter(*credited_and_published).count()
    rows = (
        db.query(Event)
        .options(*CARD_LOADS)
        .filter(*credited_and_published)
        # ``occurred_date`` is neither unique nor non-null, so ties could repeat or
        # skip rows across OFFSET pages; ``created_at, id`` makes it total.
        .order_by(Event.occurred_date.desc(), Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return rows, total
