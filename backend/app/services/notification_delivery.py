"""The notification delivery queue: the worker's drain of ``notification_deliveries``.

One drain serves every channel and hands each row to its channel's sender. A
row is claimed with ``FOR UPDATE SKIP LOCKED``, set ``sending`` and committed
before the provider call, so a crash mid-send leaves it ``sending`` and it is
never sent twice. A provider refusal puts it back in ``queued`` for another
try after ``RETRY_AFTER``, up to ``MAX_ATTEMPTS``. Each email claim first
checks the daily caps, which count every row that may have gone out
(:func:`possibly_sent_since`), so notification email never takes the share of the auth
emails, which are sent inline and never wait here. Push has no cap.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import TypedDict

from sqlalchemy import ColumnElement, and_, func, or_, select
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
from app.services.preferences import channel_enabled, email_unsubscribe_token

logger = logging.getLogger(__name__)

CAP_WINDOW = timedelta(hours=24)
MAX_ATTEMPTS = 3
RETRY_AFTER = timedelta(minutes=5)
STALE_SENDING_AFTER = timedelta(hours=1)
QUEUED_EXPIRES_AFTER = timedelta(hours=48)


def possibly_sent_since(model: type[DeliveryState], cutoff: datetime) -> ColumnElement[bool]:
    """The rows of a queue that may have reached the provider since ``cutoff``: sent, or
    claimed and left ``sending``, or failed stale out of ``sending``. A daily cap counts them
    all, since the provider may have counted them too. A row failed by refusals never left."""
    return or_(
        and_(model.status == "sent", model.sent_at >= cutoff),
        and_(
            model.status.in_(("sending", "failed")),
            model.attempts < MAX_ATTEMPTS,
            model.claimed_at >= cutoff,
        ),
    )


def _emails_sent_since(cutoff: datetime) -> tuple[ColumnElement[bool], ...]:
    return (
        NotificationDelivery.channel == "email",
        possibly_sent_since(NotificationDelivery, cutoff),
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


def _co_geolocator_invite(n: Notification, to: str) -> email.Email:
    return email.co_geolocator_invite_email(
        to=to, actor=n.actor.username, event_id=str(n.event.id), event_title=n.event.title
    )


def _co_geolocator_removed(n: Notification, to: str) -> email.Email:
    return email.co_geolocator_removed_email(
        to=to, actor=n.actor.username, event_id=str(n.event.id), event_title=n.event.title
    )


def _ownership_transferred(n: Notification, to: str) -> email.Email:
    return email.ownership_transferred_email(
        to=to, event_id=str(n.event.id), event_title=n.event.title
    )


def _organization_invite(n: Notification, to: str) -> email.Email:
    return email.organization_invite_email(
        to=to, actor=n.actor.username, slug=n.organization.slug, name=n.organization.name
    )


def _organization_invite_accepted(n: Notification, to: str) -> email.Email:
    return email.organization_invite_accepted_email(
        to=to, actor=n.actor.username, slug=n.organization.slug, name=n.organization.name
    )


def _organization_manager_inherited(n: Notification, to: str) -> email.Email:
    return email.organization_manager_inherited_email(
        to=to, slug=n.organization.slug, name=n.organization.name
    )


class _ReviewFields(TypedDict):
    actor: str
    event_id: str
    event_title: str
    organization: str | None


def _review_fields(n: Notification) -> _ReviewFields:
    """The fields of an approval or approval request row: the actor, the event, and the
    organization the row is about, when it names one."""
    return {
        "actor": n.actor.username,
        "event_id": str(n.event.id),
        "event_title": n.event.title,
        "organization": n.organization.name if n.organization is not None else None,
    }


def _approval_signer(n: Notification) -> str:
    """Who signed the approval an ``approval_revoked`` row names: its organization, or its
    reviewer."""
    if n.organization is not None:
        return n.organization.name
    return n.actor.username


_EMAIL_BUILDERS: dict[NotificationKind, Callable[[Notification, str], email.Email]] = {
    "request_fulfilled": _request_fulfilled,
    "new_follower": _new_follower,
    "x_handle_request_approved": lambda _n, to: email.x_handle_request_approved_email(to=to),
    "x_handle_request_declined": lambda _n, to: email.x_handle_request_declined_email(to=to),
    "co_geolocator_invite": _co_geolocator_invite,
    "co_geolocator_removed": _co_geolocator_removed,
    "ownership_transferred": _ownership_transferred,
    "organization_invite": _organization_invite,
    "organization_invite_accepted": _organization_invite_accepted,
    "organization_manager_inherited": _organization_manager_inherited,
    "re_approve_requested": lambda n, to: email.re_approve_requested_email(
        to=to, **_review_fields(n)
    ),
    "approval_received": lambda n, to: email.approval_received_email(to=to, **_review_fields(n)),
    "approval_revoked": lambda n, to: email.approval_revoked_email(
        to=to, signer=_approval_signer(n), event_id=str(n.event.id), event_title=n.event.title
    ),
    "approval_request_received": lambda n, to: email.approval_request_received_email(
        to=to, **_review_fields(n)
    ),
    "approval_request_declined": lambda n, to: email.approval_request_declined_email(
        to=to, **_review_fields(n)
    ),
    "organization_approval_removed": lambda n, to: email.organization_approval_removed_email(
        to=to,
        organization=n.organization_name or "An organization",
        event_id=str(n.event.id),
        event_title=n.event.title,
    ),
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
    token = email_unsubscribe_token(recipient.id, n.kind)
    message = email.one_click_unsubscribe(
        builder(n, recipient.email),
        f"{settings.api_url.rstrip('/')}/notifications/unsubscribe?token={token}",
    )
    return send_email(message, what=f"notification email {row.id}")


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


def _co_geolocator_invite_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title=f"{n.actor.username} invites you to share a geolocation",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


def _co_geolocator_removed_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title=f"{n.actor.username} removed you from a geolocation",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


def _ownership_transferred_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title="A geolocation you share is now yours",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


def _organization_path(n: Notification) -> str:
    return f"/organizations/{n.organization.slug}"


def _organization_invite_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title=f"{n.actor.username} invites you to join {n.organization.name}",
        body="Accept or decline on the organization's page.",
        path=_organization_path(n),
    )


def _organization_invite_accepted_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title=f"{n.actor.username} joined {n.organization.name}",
        body="Your invitation was accepted.",
        path=_organization_path(n),
    )


def _organization_manager_inherited_push(n: Notification) -> push.PushMessage:
    return push.PushMessage(
        title=f"You are now an org manager of {n.organization.name}",
        body="The account of its last org manager was removed.",
        path=_organization_path(n),
    )


def _re_approve_requested_push(n: Notification) -> push.PushMessage:
    approver = n.organization.name if n.organization is not None else "you"
    return push.PushMessage(
        title=f"{n.actor.username} saved a new version of a geolocation {approver} approved",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


def _approval_received_push(n: Notification) -> push.PushMessage:
    on_behalf = f" for {n.organization.name}" if n.organization is not None else ""
    return push.PushMessage(
        title=f"{n.actor.username} approved your geolocation{on_behalf}",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


def _approval_request_received_push(n: Notification) -> push.PushMessage:
    target = n.organization.name if n.organization is not None else "you"
    return push.PushMessage(
        title=f"{n.actor.username} asks {target} to approve a geolocation",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


def _approval_request_declined_push(n: Notification) -> push.PushMessage:
    decliner = n.organization.name if n.organization is not None else n.actor.username
    return push.PushMessage(
        title=f"{decliner} declined to approve your geolocation",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    )


_PUSH_BUILDERS: dict[NotificationKind, Callable[[Notification], push.PushMessage]] = {
    "request_fulfilled": _request_fulfilled_push,
    "new_follower": _new_follower_push,
    "x_handle_request_approved": lambda _n: _X_HANDLE_APPROVED_PUSH,
    "x_handle_request_declined": lambda _n: _X_HANDLE_DECLINED_PUSH,
    "co_geolocator_invite": _co_geolocator_invite_push,
    "co_geolocator_removed": _co_geolocator_removed_push,
    "ownership_transferred": _ownership_transferred_push,
    "organization_invite": _organization_invite_push,
    "organization_invite_accepted": _organization_invite_accepted_push,
    "organization_manager_inherited": _organization_manager_inherited_push,
    "re_approve_requested": _re_approve_requested_push,
    "approval_received": _approval_received_push,
    "approval_revoked": lambda n: push.PushMessage(
        title=f"The approval by {_approval_signer(n)} of your geolocation was revoked",
        body=n.event.title,
        path=f"/events/{n.event.id}",
    ),
    "approval_request_received": _approval_request_received_push,
    "approval_request_declined": _approval_request_declined_push,
    "organization_approval_removed": lambda n: push.PushMessage(
        title=f"{n.organization_name or 'An organization'} was removed from Vidit",
        body=f"Its approval of {n.event.title} is gone.",
        path=f"/events/{n.event.id}",
    ),
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
    other error counts as a refusal, so one bad row never stops a drain, except
    after an outcome that may have reached the recipient: that row stays
    ``sending`` and goes stale, so it is never sent twice. Shared by every
    queue the worker drains."""
    model, row_id = type(row), row.id
    outcome: DeliveryOutcome | None = None
    try:
        outcome = attempt()
        _land(row, outcome)
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("%s %s raised", what, row_id)
        db.rollback()
        if outcome in ("sent", "unknown"):
            return
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
