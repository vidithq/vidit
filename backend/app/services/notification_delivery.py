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
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.orm import Query, Session

from app.config import settings
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
from app.services.email_layout import Action, app_url
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


def fail_stale_sending(db: Session, model: type[DeliveryState], *, now: datetime) -> None:
    """Fail the rows of a queue left ``sending`` past ``STALE_SENDING_AFTER``. The provider may
    have taken them, so they are never retried. Shared by every queue; the caller commits."""
    db.query(model).filter(
        model.status == "sending", model.claimed_at < now - STALE_SENDING_AFTER
    ).update({"status": "failed"}, synchronize_session=False)


def claim_first[Row: DeliveryState](
    db: Session, query: Query[Row], model: type[Row], *, now: datetime
) -> Row | None:
    """Claim the oldest claimable row ``query`` holds: ``queued``, and never claimed or last
    claimed past ``RETRY_AFTER``. Set ``sending`` and committed before the provider call. Shared
    by every queue."""
    row = (
        query.filter(
            model.status == "queued",
            or_(model.claimed_at.is_(None), model.claimed_at < now - RETRY_AFTER),
        )
        .order_by(model.created_at, model.id)
        .with_for_update(skip_locked=True, of=model)
        .first()
    )
    if row is None:
        return None
    row.status = "sending"
    row.claimed_at = now
    db.commit()
    return row


def _expire(db: Session, *, now: datetime) -> None:
    fail_stale_sending(db, NotificationDelivery, now=now)
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
        .filter(NotificationDelivery.channel == channel)
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
    return claim_first(db, query, NotificationDelivery, now=now)


@dataclass(frozen=True)
class _Copy:
    """One notification in words. ``title`` is the email subject and the push title, ``text``
    the email's sentence above its ``action`` button, ``path`` the app page both open,
    ``setting`` the kind's label in Settings, and ``push_body`` the line under the push title."""

    title: str
    text: str
    action: str
    path: str
    setting: str
    push_body: str


def _event_path(n: Notification) -> str:
    return f"/events/{n.event.id}"


def _organization_path(n: Notification) -> str:
    return f"/organizations/{n.organization.slug}"


def _organization_name(n: Notification) -> str | None:
    """The organization an approval or approval request row is about, when it names one."""
    return n.organization.name if n.organization is not None else None


def _request_fulfilled(n: Notification) -> _Copy:
    actor, title = n.actor.username, n.event.title
    return _Copy(
        title=f"{actor} geolocated your request",
        text=f"{actor} answered your request “{title}” with a geolocation.",
        action="View the geolocation",
        path=_event_path(n),
        setting="Request fulfilled",
        push_body=title,
    )


def _new_follower(n: Notification) -> _Copy:
    actor = n.actor.username
    return _Copy(
        title=f"{actor} follows you on Vidit",
        text=f"{actor} now follows your work on Vidit.",
        action="View their profile",
        path=f"/profile/{actor}",
        setting="New follower",
        push_body="Open their profile to see their work.",
    )


def _x_handle_request_approved(_n: Notification) -> _Copy:
    return _Copy(
        title="Your X handle change was approved",
        text="An admin linked the X handle you requested to your Vidit account. "
        "The Vidit bot and the archive import now credit posts from that handle to you.",
        action="Open your settings",
        path="/settings",
        setting="X handle change approved",
        push_body="Posts from the new handle now count as yours.",
    )


def _x_handle_request_declined(_n: Notification) -> _Copy:
    return _Copy(
        title="Your X handle change was declined",
        text="An admin declined the X handle you requested. Your settings show the reason, "
        "and you can send a new request from there.",
        action="Open your settings",
        path="/settings",
        setting="X handle change declined",
        push_body="Open Settings to read why.",
    )


def _co_geolocator_invite(n: Notification) -> _Copy:
    actor, title = n.actor.username, n.event.title
    return _Copy(
        title=f"{actor} invites you to share a geolocation",
        text=f"{actor} invites you to be credited as a geolocator of “{title}”. "
        "Accept or decline on the geolocation's page. Editing and closing stay with the owner.",
        action="View the invitation",
        path=_event_path(n),
        setting="Geolocator invitation",
        push_body=title,
    )


def _co_geolocator_removed(n: Notification) -> _Copy:
    actor, title = n.actor.username, n.event.title
    return _Copy(
        title=f"{actor} removed you from a geolocation",
        text=f"{actor} removed you from the geolocators of “{title}”.",
        action="View the geolocation",
        path=_event_path(n),
        setting="Credit removed",
        push_body=title,
    )


def _ownership_transferred(n: Notification) -> _Copy:
    title = n.event.title
    return _Copy(
        title="A geolocation you share is now yours",
        text=f"You now own “{title}”: the account of its previous owner was removed. "
        "You can edit, correct and close it.",
        action="View the geolocation",
        path=_event_path(n),
        setting="Ownership transferred",
        push_body=title,
    )


def _organization_invite(n: Notification) -> _Copy:
    actor, name = n.actor.username, n.organization.name
    return _Copy(
        title=f"{actor} invites you to join {name}",
        text=f"{actor}, an org manager of {name}, invites you to join the organization on Vidit. "
        "Accept or decline on its page.",
        action="View the invitation",
        path=_organization_path(n),
        setting="Organization invite",
        push_body="Accept or decline on the organization's page.",
    )


def _organization_invite_accepted(n: Notification) -> _Copy:
    actor, name = n.actor.username, n.organization.name
    return _Copy(
        title=f"{actor} joined {name}",
        text=f"{actor} accepted your invitation and is now a member of {name}.",
        action="View the organization",
        path=_organization_path(n),
        setting="Invite accepted",
        push_body="Your invitation was accepted.",
    )


def _organization_manager_inherited(n: Notification) -> _Copy:
    name = n.organization.name
    return _Copy(
        title=f"You are now an org manager of {name}",
        text=f"The account of the last org manager of {name} was removed, and you were its "
        "earliest member, so you are now its org manager. You can invite analysts, "
        "change roles and edit its profile.",
        action="View the organization",
        path=_organization_path(n),
        setting="Now org manager",
        push_body="The account of its last org manager was removed.",
    )


def _re_approve_requested(n: Notification) -> _Copy:
    actor, title, org = n.actor.username, n.event.title, _organization_name(n)
    whose = f"{org}'s approval" if org else "Your approval"
    again = f"approve again as {org}" if org else "approve again"
    return _Copy(
        title=f"{actor} saved a new version of a geolocation {org or 'you'} approved",
        text=f"{actor} saved a new version of “{title}”. {whose} covered the version "
        f"before it, so it no longer stands. See what changed and {again}.",
        action="Review the new version",
        path=_event_path(n),
        setting="New version to approve",
        push_body=title,
    )


def _approval_received(n: Notification) -> _Copy:
    actor, title, org = n.actor.username, n.event.title, _organization_name(n)
    on_behalf = f" for {org}" if org else ""
    return _Copy(
        title=f"{actor} approved your geolocation{on_behalf}",
        text=f"{actor} approved the current version of “{title}”{on_behalf}.",
        action="View the geolocation",
        path=_event_path(n),
        setting="Approval received",
        push_body=title,
    )


def _approval_revoked(n: Notification) -> _Copy:
    # The signer is the organization the approval was placed for, or else its reviewer.
    signer, title = _organization_name(n) or n.actor.username, n.event.title
    return _Copy(
        title=f"The approval by {signer} of your geolocation was revoked",
        text=f"The approval by {signer} of “{title}” was revoked. It no longer stands.",
        action="View the geolocation",
        path=_event_path(n),
        setting="Approval revoked",
        push_body=title,
    )


def _approval_request_received(n: Notification) -> _Copy:
    actor, title, org = n.actor.username, n.event.title, _organization_name(n)
    target = org or "you"
    as_target = f" as {org}" if org else ""
    return _Copy(
        title=f"{actor} asks {target} to approve a geolocation",
        text=f"{actor} asks {target} to approve “{title}”. Approve its current "
        f"version{as_target}, or decline the request, from the geolocation's page.",
        action="Review the geolocation",
        path=_event_path(n),
        setting="Approval request",
        push_body=title,
    )


def _approval_request_declined(n: Notification) -> _Copy:
    actor, title, org = n.actor.username, n.event.title, _organization_name(n)
    on_behalf = f" for {org}" if org else ""
    return _Copy(
        title=f"{org or actor} declined to approve your geolocation",
        text=f"{actor} declined{on_behalf} your request to approve “{title}”.",
        action="View the geolocation",
        path=_event_path(n),
        setting="Approval request declined",
        push_body=title,
    )


def _organization_approval_removed(n: Notification) -> _Copy:
    org, title = n.organization_name or "An organization", n.event.title
    return _Copy(
        title=f"{org} was removed from Vidit",
        text=f"{org} was removed from Vidit, and its approval of “{title}” "
        "went with it. The event and its other approvals are unchanged.",
        action="View the geolocation",
        path=_event_path(n),
        setting="Organization approval removed",
        push_body=f"Its approval of {title} is gone.",
    )


# One entry per kind renders both channels; a kind missing here is skipped on each.
_COPY: dict[NotificationKind, Callable[[Notification], _Copy]] = {
    "request_fulfilled": _request_fulfilled,
    "new_follower": _new_follower,
    "x_handle_request_approved": _x_handle_request_approved,
    "x_handle_request_declined": _x_handle_request_declined,
    "co_geolocator_invite": _co_geolocator_invite,
    "co_geolocator_removed": _co_geolocator_removed,
    "ownership_transferred": _ownership_transferred,
    "organization_invite": _organization_invite,
    "organization_invite_accepted": _organization_invite_accepted,
    "organization_manager_inherited": _organization_manager_inherited,
    "re_approve_requested": _re_approve_requested,
    "approval_received": _approval_received,
    "approval_revoked": _approval_revoked,
    "approval_request_received": _approval_request_received,
    "approval_request_declined": _approval_request_declined,
    "organization_approval_removed": _organization_approval_removed,
}


def _email_for(n: Notification, to: str) -> email.Email:
    copy = _COPY[n.kind](n)
    return email.notification_email(
        to=to,
        subject=copy.title,
        text=copy.text,
        action=Action(copy.action, app_url(copy.path)),
        setting=copy.setting,
    )


def _push_for(n: Notification) -> push.PushMessage:
    copy = _COPY[n.kind](n)
    return push.PushMessage(title=copy.title, body=copy.push_body, path=copy.path)


def _send_email(db: Session, row: NotificationDelivery, recipient: User) -> DeliveryOutcome:
    if not has_verified_email(recipient):
        return "skipped"
    assert recipient.email is not None
    n = row.notification
    if n.kind not in _COPY:
        logger.warning("notification email %s skipped: no copy for kind %r", row.id, n.kind)
        return "skipped"
    token = email_unsubscribe_token(recipient.id, n.kind)
    message = email.one_click_unsubscribe(
        _email_for(n, recipient.email),
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


def _send_push(db: Session, row: NotificationDelivery, recipient: User) -> DeliveryOutcome:
    n = row.notification
    if n.kind not in _COPY:
        logger.warning("notification push %s skipped: no copy for kind %r", row.id, n.kind)
        return "skipped"
    return push.send(db, user_id=recipient.id, message=_push_for(n))


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
