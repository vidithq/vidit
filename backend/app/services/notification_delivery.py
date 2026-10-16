"""The notification delivery queue: the worker's drain of ``notification_deliveries``.

One drain serves every channel and hands each row to its channel's sender. A
row is claimed with ``FOR UPDATE SKIP LOCKED``, set ``sending`` and committed
before the provider call, so a crash mid-send leaves it ``sending`` and it is
never sent twice. A provider refusal puts it back in ``queued`` for another
try after ``RETRY_AFTER``, up to ``MAX_ATTEMPTS``. Each email claim first
checks the daily caps, so notification email never takes the share of the auth
emails, which are sent inline and never wait here. Push has no cap.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import partial

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.event import Event
from app.models.notification import (
    DeliveryOutcome,
    DeliveryState,
    Notification,
    NotificationChannel,
    NotificationDelivery,
    NotificationKind,
)
from app.models.user import User
from app.services import email, push
from app.services.notifications import has_verified_email, is_visible
from app.services.preferences import channel_enabled

logger = logging.getLogger(__name__)

CAP_WINDOW = timedelta(hours=24)
MAX_ATTEMPTS = 3
RETRY_AFTER = timedelta(minutes=5)
STALE_SENDING_AFTER = timedelta(hours=1)
QUEUED_EXPIRES_AFTER = timedelta(hours=48)


def _emails_sent_since(cutoff: datetime) -> tuple[ColumnElement[bool], ...]:
    return (
        NotificationDelivery.channel == "email",
        NotificationDelivery.status == "sent",
        NotificationDelivery.sent_at >= cutoff,
    )


def _emails_sent_count(db: Session, *, now: datetime) -> int:
    return (
        db.query(func.count(NotificationDelivery.id))
        .filter(*_emails_sent_since(now - CAP_WINDOW))
        .scalar()
        or 0
    )


def _expire(db: Session, *, now: datetime) -> None:
    db.query(NotificationDelivery).filter(
        NotificationDelivery.status == "sending",
        NotificationDelivery.claimed_at < now - STALE_SENDING_AFTER,
    ).update({"status": "failed"}, synchronize_session=False)
    db.query(NotificationDelivery).filter(
        NotificationDelivery.status == "queued",
        NotificationDelivery.created_at < now - QUEUED_EXPIRES_AFTER,
    ).update({"status": "skipped"}, synchronize_session=False)
    db.commit()


def _claim_next(
    db: Session, *, now: datetime, channel: NotificationChannel
) -> NotificationDelivery | None:
    query = (
        db.query(NotificationDelivery)
        .join(Notification, NotificationDelivery.notification_id == Notification.id)
        .filter(
            NotificationDelivery.channel == channel,
            NotificationDelivery.status == "queued",
            or_(
                NotificationDelivery.claimed_at.is_(None),
                NotificationDelivery.claimed_at < now - RETRY_AFTER,
            ),
        )
    )
    if channel == "email":
        if _emails_sent_count(db, now=now) >= settings.notification_email_daily_cap:
            return None
        capped_users = (
            select(Notification.user_id)
            .join(NotificationDelivery, NotificationDelivery.notification_id == Notification.id)
            .where(*_emails_sent_since(now - CAP_WINDOW))
            .group_by(Notification.user_id)
            .having(func.count() >= settings.notification_email_daily_cap_per_user)
        )
        query = query.filter(Notification.user_id.not_in(capped_users))
    row = (
        query.order_by(NotificationDelivery.created_at, NotificationDelivery.id)
        .with_for_update(skip_locked=True, of=NotificationDelivery)
        .first()
    )
    if row is None:
        return None
    row.status = "sending"
    row.claimed_at = now
    db.commit()
    return row


def _request_fulfilled(n: Notification, to: str) -> email.Email:
    event: Event = n.event
    return email.request_fulfilled_email(
        to=to, actor=n.actor.username, event_id=str(event.id), event_title=event.title
    )


def _new_follower(n: Notification, to: str) -> email.Email:
    return email.new_follower_email(to=to, actor=n.actor.username)


_EMAIL_BUILDERS: dict[NotificationKind, Callable[[Notification, str], email.Email]] = {
    "request_fulfilled": _request_fulfilled,
    "new_follower": _new_follower,
    "x_handle_request_approved": lambda _n, to: email.x_handle_request_approved_email(to=to),
    "x_handle_request_declined": lambda _n, to: email.x_handle_request_declined_email(to=to),
}


def _send_email(db: Session, row: NotificationDelivery, recipient: User) -> DeliveryOutcome:
    if not has_verified_email(recipient):
        return "skipped"
    assert recipient.email is not None
    n = row.notification
    builder = _EMAIL_BUILDERS.get(n.kind)
    if builder is None:
        logger.warning("notification email %s skipped: no builder for kind %r", row.id, n.kind)
        return "skipped"
    return send_email(builder(n, recipient.email), what=f"notification email {row.id}")


def send_email(message: email.Email, *, what: str) -> DeliveryOutcome:
    """Hand ``message`` to the provider and report the outcome. Shared by
    every email queue."""
    try:
        email.send(message)
    except email.EmailRejectedError as exc:
        logger.warning("%s refused: %s", what, exc)
        return "refused"
    except email.EmailSendError as exc:
        logger.warning("%s outcome unknown: %s", what, exc)
        return "unknown"
    return "sent"


def _request_fulfilled_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title=f"{n.actor.username} geolocated your request",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


def _new_follower_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title=f"{n.actor.username} follows you on Vidit",
        body="Open their profile to see their work.",
        path=f"/profile/{n.actor.username}",
    )


_X_HANDLE_APPROVED_PUSH = push.PushMessage(
    title="Your X handle change was approved",
    body="Posts from the new handle now count as yours.",
    path="/settings",
)

_X_HANDLE_DECLINED_PUSH = push.PushMessage(
    title="Your X handle change was declined",
    body="Open Settings to read why.",
    path="/settings",
)

_PUSH_BUILDERS: dict[NotificationKind, Callable[[Notification], push.PushMessage]] = {
    "request_fulfilled": _request_fulfilled_push,
    "new_follower": _new_follower_push,
    "x_handle_request_approved": lambda _n: _X_HANDLE_APPROVED_PUSH,
    "x_handle_request_declined": lambda _n: _X_HANDLE_DECLINED_PUSH,
}


def _send_push(db: Session, row: NotificationDelivery, recipient: User) -> DeliveryOutcome:
    n = row.notification
    builder = _PUSH_BUILDERS.get(n.kind)
    if builder is None:
        logger.warning("notification push %s skipped: no builder for kind %r", row.id, n.kind)
        return "skipped"
    return push.send(db, user_id=recipient.id, message=builder(n))


_SENDERS: dict[
    NotificationChannel, Callable[[Session, NotificationDelivery, User], DeliveryOutcome]
] = {
    "email": _send_email,
    "push": _send_push,
}


def _recipient(db: Session, row: NotificationDelivery) -> User | None:
    """The live recipient, or None when the row must be skipped: the recipient
    is soft-deleted or deactivated, the switch is off, or the feed would hide
    the notification."""
    n = row.notification
    recipient = db.get(User, n.user_id)
    if (
        recipient is None
        or recipient.deleted_at is not None
        or not recipient.is_active
        or not channel_enabled(db, user_id=recipient.id, kind=n.kind, channel=row.channel)
        or not is_visible(db, notification_id=n.id, user=recipient)
    ):
        return None
    return recipient


def _count_failure(row: DeliveryState) -> None:
    row.attempts += 1
    row.status = "failed" if row.attempts >= MAX_ATTEMPTS else "queued"


def _land(row: DeliveryState, outcome: DeliveryOutcome) -> None:
    if outcome == "sent":
        row.status = "sent"
        row.sent_at = datetime.now(UTC)
    elif outcome == "skipped":
        row.status = "skipped"
    elif outcome == "refused":
        _count_failure(row)


def deliver(
    db: Session,
    row: DeliveryState,
    attempt: Callable[[], DeliveryOutcome],
    *,
    what: str,
) -> None:
    """Run ``attempt`` for a row claimed ``sending`` and land its outcome. Any
    other error counts as a refusal, so one bad row never stops a drain.
    Shared by every queue the worker drains."""
    model, row_id = type(row), row.id
    try:
        _land(row, attempt())
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("%s %s raised", what, row_id)
        db.rollback()
        fresh = db.get(model, row_id)
        if fresh is not None:
            _count_failure(fresh)
            db.commit()


def _attempt(db: Session, row: NotificationDelivery) -> DeliveryOutcome:
    recipient = _recipient(db, row)
    return _SENDERS[row.channel](db, row, recipient) if recipient is not None else "skipped"


def drain(db: Session) -> int:
    """Send every claimable row, channel by channel; return the rows handled."""
    _expire(db, now=datetime.now(UTC))
    handled = 0
    for channel in _SENDERS:
        while (row := _claim_next(db, now=datetime.now(UTC), channel=channel)) is not None:
            deliver(db, row, partial(_attempt, db, row), what=f"notification {channel}")
            handled += 1
    return handled
