"""Stored notifications: emitting a row, the feed, and per-row read state.

An emitter adds its row to the caller's session and never commits, so the row
lands in the transaction of the action it reports. For each channel the
recipient can receive on (a verified address for email, a registered device for
push) whose switch for the kind is on, a ``notification_deliveries`` row joins
it for the worker to send. Reads hide a
row whose event is soft-deleted or taken down, or whose actor is soft-deleted,
whenever that happened.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Query, Session, aliased, contains_eager

from app.models.event import Event
from app.models.notification import (
    Notification,
    NotificationChannel,
    NotificationDelivery,
    NotificationKind,
)
from app.models.user import User
from app.schemas.notification import NotificationEventRef, NotificationRead
from app.schemas.user import AuthorRef
from app.services import push
from app.services.event_filters import visible_events
from app.services.pagination import keyset_before
from app.services.preferences import channel_enabled

_Actor = aliased(User)


def _emit(
    db: Session,
    *,
    recipient_id: uuid.UUID,
    kind: NotificationKind,
    actor_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
) -> None:
    if actor_id == recipient_id:
        return
    row = Notification(user_id=recipient_id, kind=kind, actor_id=actor_id, event_id=event_id)
    db.add(row)
    recipient = db.get(User, recipient_id)
    if recipient is None:
        return
    reachable: dict[NotificationChannel, bool] = {
        "email": has_verified_email(recipient),
        "push": push.has_device(db, user_id=recipient_id),
    }
    for channel, can_receive in reachable.items():
        if can_receive and channel_enabled(db, user_id=recipient_id, kind=kind, channel=channel):
            db.add(NotificationDelivery(notification=row, channel=channel))


def has_verified_email(user: User) -> bool:
    """Notification email goes only to a proven address; an older account
    without the verification stamp gets none."""
    return user.email is not None and user.email_verified_at is not None


def notify_request_fulfilled(db: Session, *, event: Event, fulfiller: User) -> None:
    """Tell the analyst who opened ``event`` that ``fulfiller`` answered it.

    Silent on a self-fulfilment and on a request whose opener was erased.
    """
    if event.requested_by_id is None:
        return
    _emit(
        db,
        recipient_id=event.requested_by_id,
        kind="request_fulfilled",
        actor_id=fulfiller.id,
        event_id=event.id,
    )


def notify_new_follower(db: Session, *, follower_id: uuid.UUID, followed_id: uuid.UUID) -> None:
    """Tell ``followed_id`` that ``follower_id`` follows them.

    One row per follower: an unfollow and re-follow does not notify again.
    """
    seen = (
        db.query(Notification.id)
        .filter(
            Notification.user_id == followed_id,
            Notification.kind == "new_follower",
            Notification.actor_id == follower_id,
        )
        .first()
    )
    if seen is None:
        _emit(db, recipient_id=followed_id, kind="new_follower", actor_id=follower_id)


def notify_x_handle_request_outcome(
    db: Session, *, recipient_id: uuid.UUID, approved: bool
) -> None:
    """Tell ``recipient_id`` that an admin decided their X handle request.

    The row names no actor: the decision is the admins', not one admin's.
    """
    _emit(
        db,
        recipient_id=recipient_id,
        kind="x_handle_request_approved" if approved else "x_handle_request_declined",
    )


def _visible_rows(db: Session, user: User) -> Query[Notification]:
    """``user``'s rows whose event and actor a reader may still see."""
    return (
        db.query(Notification)
        .outerjoin(Event, Notification.event_id == Event.id)
        .outerjoin(_Actor, Notification.actor_id == _Actor.id)
        .filter(
            Notification.user_id == user.id,
            or_(Notification.event_id.is_(None), and_(*visible_events())),
            or_(Notification.actor_id.is_(None), _Actor.deleted_at.is_(None)),
        )
    )


def is_visible(db: Session, *, notification_id: uuid.UUID, user: User) -> bool:
    """Whether ``user``'s row ``notification_id`` still passes the feed filter."""
    return _visible_rows(db, user).filter(Notification.id == notification_id).first() is not None


def list_feed(
    db: Session,
    *,
    user: User,
    limit: int,
    cursor: tuple[datetime, uuid.UUID] | None,
) -> list[Notification]:
    """One window of the feed, newest first, over-fetched by one row for
    ``take_page``."""
    query = _visible_rows(db, user).options(
        contains_eager(Notification.event), contains_eager(Notification.actor.of_type(_Actor))
    )
    if cursor is not None:
        query = query.filter(keyset_before(Notification.created_at, Notification.id, cursor))
    return (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit + 1)
        .all()
    )


def build_read(row: Notification) -> NotificationRead:
    return NotificationRead(
        id=row.id,
        kind=row.kind,
        created_at=row.created_at,
        actor=AuthorRef.model_validate(row.actor) if row.actor is not None else None,
        event=NotificationEventRef.model_validate(row.event) if row.event is not None else None,
        read_at=row.read_at,
    )


def unread_count(db: Session, *, user: User) -> int:
    return (
        _visible_rows(db, user)
        .filter(Notification.read_at.is_(None))
        .with_entities(func.count(Notification.id))
        .scalar()
        or 0
    )


def mark_read(db: Session, *, user: User, ids: list[uuid.UUID]) -> None:
    """Stamp ``read_at`` on the listed rows ``user`` owns. Another analyst's id
    and an already-read row are left as they are."""
    db.query(Notification).filter(
        Notification.id.in_(ids),
        Notification.user_id == user.id,
        Notification.read_at.is_(None),
    ).update({Notification.read_at: datetime.now(UTC)}, synchronize_session=False)
