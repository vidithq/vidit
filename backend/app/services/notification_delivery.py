"""The notification email queue: the worker's drain of ``notification_deliveries``.

A row is claimed with ``FOR UPDATE SKIP LOCKED``, set ``sending`` and committed
before the provider call, so a crash mid-send leaves it ``sending`` and it is
never sent twice. A provider refusal puts it back in ``queued`` for another
try after ``RETRY_AFTER``, up to ``MAX_ATTEMPTS``. Each claim first checks the
daily caps, so notification email never takes the share of the auth emails,
which are sent inline and never wait here.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.event import Event
from app.models.notification import Notification, NotificationDelivery, NotificationKind
from app.models.user import User
from app.services import email
from app.services.notifications import has_verified_email, is_visible
from app.services.preferences import channel_enabled

logger = logging.getLogger(__name__)

CAP_WINDOW = timedelta(hours=24)
MAX_ATTEMPTS = 3
RETRY_AFTER = timedelta(minutes=5)
STALE_SENDING_AFTER = timedelta(hours=1)
QUEUED_EXPIRES_AFTER = timedelta(hours=48)


def _sent_since(cutoff: datetime) -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    return (NotificationDelivery.status == "sent", NotificationDelivery.sent_at >= cutoff)


def _sent_count(db: Session, *, now: datetime) -> int:
    return (
        db.query(func.count(NotificationDelivery.id))
        .filter(*_sent_since(now - CAP_WINDOW))
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


def _claim_next(db: Session, *, now: datetime) -> NotificationDelivery | None:
    if _sent_count(db, now=now) >= settings.notification_email_daily_cap:
        return None
    capped_users = (
        select(Notification.user_id)
        .join(NotificationDelivery, NotificationDelivery.notification_id == Notification.id)
        .where(*_sent_since(now - CAP_WINDOW))
        .group_by(Notification.user_id)
        .having(func.count() >= settings.notification_email_daily_cap_per_user)
    )
    row = (
        db.query(NotificationDelivery)
        .join(Notification, NotificationDelivery.notification_id == Notification.id)
        .filter(
            NotificationDelivery.status == "queued",
            or_(
                NotificationDelivery.claimed_at.is_(None),
                NotificationDelivery.claimed_at < now - RETRY_AFTER,
            ),
            Notification.user_id.not_in(capped_users),
        )
        .order_by(NotificationDelivery.created_at, NotificationDelivery.id)
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


_BUILDERS: dict[NotificationKind, Callable[[Notification, str], email.Email]] = {
    "request_fulfilled": _request_fulfilled,
    "new_follower": _new_follower,
}


def _message(db: Session, row: NotificationDelivery) -> email.Email | None:
    """The email to send, or None when the row must be skipped: the switch is
    off, the address is gone or unverified, the recipient is soft-deleted, or
    the feed would hide the notification."""
    n = row.notification
    recipient = db.get(User, n.user_id)
    if (
        recipient is None
        or recipient.deleted_at is not None
        or not recipient.is_active
        or not has_verified_email(recipient)
        or not channel_enabled(db, user_id=recipient.id, kind=n.kind, channel=row.channel)
        or not is_visible(db, notification_id=n.id, user=recipient)
    ):
        return None
    assert recipient.email is not None
    return _BUILDERS[n.kind](n, recipient.email)


def _deliver(db: Session, row: NotificationDelivery) -> None:
    message = _message(db, row)
    if message is None:
        row.status = "skipped"
        db.commit()
        return
    try:
        email.send(message)
    except email.EmailRejectedError as exc:
        row.attempts += 1
        row.status = "failed" if row.attempts >= MAX_ATTEMPTS else "queued"
        db.commit()
        logger.warning("notification email %s refused: %s", row.id, exc)
        return
    except email.EmailSendError as exc:
        # The provider may have accepted it: leave ``sending`` to go stale.
        logger.warning("notification email %s outcome unknown: %s", row.id, exc)
        return
    row.status = "sent"
    row.sent_at = datetime.now(UTC)
    db.commit()


def drain(db: Session) -> int:
    """Send every claimable row; return the rows handled."""
    _expire(db, now=datetime.now(UTC))
    handled = 0
    while (row := _claim_next(db, now=datetime.now(UTC))) is not None:
        _deliver(db, row)
        handled += 1
    return handled
