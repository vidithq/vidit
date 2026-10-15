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
from typing import NamedTuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Query, Session, aliased, contains_eager, joinedload

from app.models.approval import EventApproval
from app.models.event import STATUS_GEOLOCATED, Event, EventGeolocator, EventGeolocatorInvite
from app.models.notification import (
    Notification,
    NotificationChannel,
    NotificationDelivery,
    NotificationKind,
)
from app.models.organization import OrganizationInvite
from app.models.user import User
from app.schemas.notification import NotificationEventRef, NotificationRead
from app.schemas.organization import OrganizationRef
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
    organization_id: uuid.UUID | None = None,
) -> None:
    if actor_id == recipient_id:
        return
    row = Notification(
        user_id=recipient_id,
        kind=kind,
        actor_id=actor_id,
        event_id=event_id,
        organization_id=organization_id,
    )
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


def notify_co_geolocator_invite(db: Session, *, event: Event, invitee_id: uuid.UUID) -> None:
    """Tell ``invitee_id`` that the owner of ``event`` invites them to share its credit."""
    _emit(
        db,
        recipient_id=invitee_id,
        kind="co_geolocator_invite",
        actor_id=event.owner_id,
        event_id=event.id,
    )


def notify_co_geolocator_removed(db: Session, *, event: Event, removed_id: uuid.UUID) -> None:
    """Tell ``removed_id`` that the owner of ``event`` took their credit off it."""
    _emit(
        db,
        recipient_id=removed_id,
        kind="co_geolocator_removed",
        actor_id=event.owner_id,
        event_id=event.id,
    )


def notify_ownership_transferred(db: Session, *, event: Event, heir_id: uuid.UUID) -> None:
    """Tell ``heir_id`` that ``event`` is now theirs because its owner's account was erased.

    No actor: the row must not name the erased analyst.
    """
    _emit(db, recipient_id=heir_id, kind="ownership_transferred", event_id=event.id)


def notify_organization_invite(db: Session, *, invite: OrganizationInvite) -> None:
    """Tell the invitee that an org-admin invited them to join."""
    _emit(
        db,
        recipient_id=invite.user_id,
        kind="organization_invite",
        actor_id=invite.invited_by_id,
        organization_id=invite.organization_id,
    )


def notify_organization_invite_accepted(
    db: Session, *, invite: OrganizationInvite, member_id: uuid.UUID
) -> None:
    """Tell the org-admin who sent ``invite`` that it was accepted.

    Silent when that org-admin's account is gone. A decline notifies nobody.
    """
    if invite.invited_by_id is None:
        return
    _emit(
        db,
        recipient_id=invite.invited_by_id,
        kind="organization_invite_accepted",
        actor_id=member_id,
        organization_id=invite.organization_id,
    )


def notify_organization_admin_inherited(
    db: Session, *, organization_id: uuid.UUID, heir_id: uuid.UUID
) -> None:
    """Tell ``heir_id`` they became an org-admin because the last one left Vidit.

    Names no actor: the notification never says whose account was erased.
    """
    _emit(
        db,
        recipient_id=heir_id,
        kind="organization_admin_inherited",
        organization_id=organization_id,
    )


def notify_approval_received(db: Session, *, event: Event, reviewer_id: uuid.UUID) -> None:
    """Tell the owner of ``event`` that ``reviewer_id`` approved its live version."""
    _emit(
        db,
        recipient_id=event.owner_id,
        kind="approval_received",
        actor_id=reviewer_id,
        event_id=event.id,
    )


def notify_re_approve_requested(
    db: Session, *, event: Event, editor_id: uuid.UUID, superseded_version: int
) -> None:
    """Ask every analyst whose approval of ``superseded_version`` stood to review the new one.

    A revoked approval asks nothing.
    """
    reviewer_ids = db.scalars(
        select(EventApproval.reviewer_id).where(
            EventApproval.event_id == event.id,
            EventApproval.version_no == superseded_version,
            EventApproval.revoked_at.is_(None),
        )
    ).all()
    for reviewer_id in reviewer_ids:
        _emit(
            db,
            recipient_id=reviewer_id,
            kind="re_approve_requested",
            actor_id=editor_id,
            event_id=event.id,
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
        contains_eager(Notification.event),
        contains_eager(Notification.actor.of_type(_Actor)),
        joinedload(Notification.organization),
    )
    if cursor is not None:
        query = query.filter(keyset_before(Notification.created_at, Notification.id, cursor))
    return (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit + 1)
        .all()
    )


def pending_invites(db: Session, *, user: User, rows: list[Notification]) -> set[uuid.UUID]:
    """The events among ``rows``' invitations that still wait for ``user``'s answer."""
    event_ids = {r.event_id for r in rows if r.kind == "co_geolocator_invite" and r.event_id}
    if not event_ids:
        return set()
    return set(
        db.scalars(
            select(EventGeolocatorInvite.event_id).where(
                EventGeolocatorInvite.user_id == user.id,
                EventGeolocatorInvite.event_id.in_(event_ids),
            )
        )
    )


class ReapprovalOffer(NamedTuple):
    """What a re-approval row offers: the live version to approve, and the latest earlier
    version ``user``'s approval still stands on, the base of the change list."""

    live_version: int
    approved_version: int | None


def reapproval_offers(
    db: Session, *, user: User, rows: list[Notification]
) -> dict[uuid.UUID, ReapprovalOffer]:
    """The offer of each event among ``rows``' re-approval requests that ``user`` can approve
    now: published, not credited to them, and not yet reviewed by them at the live version.

    Callers eager-load ``Notification.event``.
    """
    candidates = {
        r.event.id: r.event.version_no
        for r in rows
        if r.kind == "re_approve_requested"
        and r.event is not None
        and r.event.status == STATUS_GEOLOCATED
        and r.event.owner_id != user.id
    }
    if not candidates:
        return {}
    credited = set(
        db.scalars(
            select(EventGeolocator.event_id).where(
                EventGeolocator.user_id == user.id,
                EventGeolocator.event_id.in_(candidates),
            )
        )
    )
    reviewed: set[tuple[uuid.UUID, int]] = set()
    standing: dict[uuid.UUID, int] = {}
    for event_id, version, revoked_at in db.execute(
        select(EventApproval.event_id, EventApproval.version_no, EventApproval.revoked_at).where(
            EventApproval.reviewer_id == user.id,
            EventApproval.event_id.in_(candidates),
        )
    ).tuples():
        reviewed.add((event_id, version))
        # Mirrored by the frontend's lib/approvals.standingApprovalBefore; change both.
        if revoked_at is None and version < candidates[event_id]:
            standing[event_id] = max(version, standing.get(event_id, 0))
    return {
        event_id: ReapprovalOffer(version, standing.get(event_id))
        for event_id, version in candidates.items()
        if event_id not in credited and (event_id, version) not in reviewed
    }


def build_read(
    row: Notification, *, pending: set[uuid.UUID], offers: dict[uuid.UUID, ReapprovalOffer]
) -> NotificationRead:
    offer = (
        offers.get(row.event_id)
        if row.kind == "re_approve_requested" and row.event_id is not None
        else None
    )
    return NotificationRead(
        id=row.id,
        kind=row.kind,
        created_at=row.created_at,
        actor=AuthorRef.model_validate(row.actor) if row.actor is not None else None,
        event=NotificationEventRef.model_validate(row.event) if row.event is not None else None,
        organization=(
            OrganizationRef.model_validate(row.organization)
            if row.organization is not None
            else None
        ),
        read_at=row.read_at,
        invite_pending=row.kind == "co_geolocator_invite" and row.event_id in pending,
        reapprove_version=offer.live_version if offer is not None else None,
        approved_version=offer.approved_version if offer is not None else None,
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
