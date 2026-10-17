import uuid
from datetime import datetime
from typing import Literal

from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import Row, Select, and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from app.models.event import Event, feed_at
from app.models.follow import Follow
from app.models.user import User
from app.services import notifications
from app.services.event_filters import (
    approval_predicates,
    open_requests,
    published_credited_to,
    published_events,
    taxonomy_predicates,
    visible_events,
)
from app.services.geolocator_credit import CREDIT_LOAD
from app.services.pagination import keyset_before, take_page
from app.services.thumbnails import thumbnail_media_criteria

FeedScope = Literal["following", "all"]
FeedKind = Literal["geolocation", "request"]


def follow_user(db: Session, *, follower_id: uuid.UUID, followed_user: User) -> bool:
    """Insert a follow row and notify the followed analyst. Idempotent: returns
    ``False`` if the edge exists.

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
    notifications.notify_new_follower(db, follower_id=follower_id, followed_id=followed_user.id)
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


def is_mutual_follow(db: Session, *, a_id: uuid.UUID, b_id: uuid.UUID) -> bool:
    """Whether ``a`` and ``b`` follow each other."""
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


def get_feed(
    db: Session,
    *,
    user_id: uuid.UUID,
    scope: FeedScope,
    size: int,
    cursor: tuple[datetime, uuid.UUID] | None = None,
    kind: list[FeedKind] | None = None,
    conflict: list[str] | None = None,
    capture_source: list[str] | None = None,
    tag: list[str] | None = None,
    approved: bool = False,
    approved_by: str | None = None,
    approved_by_org: str | None = None,
) -> tuple[list[Row[tuple[Event, float | None, float | None, datetime]]], bool]:
    """One page of the feed, newest first, and whether a next page holds a row.

    The feed carries two kinds of row: a geolocation an analyst published
    (:func:`services.event_filters.published_events`) and a request an analyst has open
    (:func:`services.event_filters.open_requests`). An open request's owner is its requester:
    ownership moves only when a request is geolocated. ``scope="following"`` keeps the
    geolocations credited to an analyst ``user_id`` follows (owner or co-geolocator) and the
    requests such an analyst owns; ``"all"`` keeps every row.

    ``kind`` keeps the named kinds (both when empty). ``conflict``, ``capture_source`` and ``tag``
    narrow through :func:`services.event_filters.taxonomy_predicates`, and ``approved``,
    ``approved_by`` and ``approved_by_org`` through
    :func:`services.event_filters.approval_predicates`, as on ``GET /events``.

    Rows are ``(event, lat, lng, feed_at)`` ordered by ``feed_at DESC, id DESC``
    (:func:`models.event.feed_at`), a total order over both kinds, so a keyset walk
    neither repeats nor skips a row.
    """
    kinds = set(kind or ("geolocation", "request"))
    legs = []
    if scope == "following":
        followed = select(Follow.followed_id).where(Follow.follower_id == user_id)
        if "geolocation" in kinds:
            legs.append(published_credited_to(followed))
        if "request" in kinds:
            legs.append(and_(open_requests(), Event.owner_id.in_(followed)))
    else:
        if "geolocation" in kinds:
            legs.append(published_events())
        if "request" in kinds:
            legs.append(open_requests())

    key = feed_at()
    query = (
        db.query(
            Event,
            ST_Y(Event.event_coords).label("lat"),
            ST_X(Event.event_coords).label("lng"),
            key.label("feed_at"),
        )
        # Loader choice: see ``list_detections`` in ``routers/events/read.py``.
        .options(
            joinedload(Event.owner),
            selectinload(Event.tags),
            selectinload(Event.conflicts),
            selectinload(Event.media.and_(thumbnail_media_criteria())),
            CREDIT_LOAD,
        )
        .filter(
            *visible_events(),
            or_(*legs),
            *taxonomy_predicates(conflict=conflict, capture_source=capture_source, tag=tag),
            *approval_predicates(
                approved=approved, approved_by=approved_by, approved_by_org=approved_by_org
            ),
        )
    )
    if cursor is not None:
        query = query.filter(keyset_before(key, Event.id, cursor))
    window = query.order_by(key.desc(), Event.id.desc()).limit(size + 1).all()
    return take_page(window, size)
