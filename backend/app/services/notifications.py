"""Stored notifications: emitting a row, the feed, and per-row read state.

An emitter adds its row to the caller's session and never commits, so the row
lands in the transaction of the action it reports. For each channel the
recipient can receive on (a verified address for email, a registered device for
push) whose switch for the kind is on, a ``notification_deliveries`` row joins
it for the worker to send. An actor whose actions queued
``settings.notification_email_daily_cap_per_actor`` emails in the trailing day
queues no more: the row still reaches the feed and push. Reads hide a
row whose event is soft-deleted or taken down, or whose actor is soft-deleted or
deactivated, whenever that happened.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Query, Session, aliased, contains_eager, joinedload

from app.config import settings
from app.models.approval import EventApproval
from app.models.event import (
    STATUS_GEOLOCATED,
    Event,
    EventGeolocator,
    EventGeolocatorDeparture,
    EventGeolocatorInvite,
)
from app.models.notification import (
    Notification,
    NotificationChannel,
    NotificationDelivery,
    NotificationKind,
)
from app.models.organization import OrganizationInvite, OrganizationMember
from app.models.review_request import ReviewRequest
from app.models.user import User
from app.schemas.notification import NotificationEventRef, NotificationRead
from app.schemas.organization import OrganizationRef
from app.schemas.user import AuthorRef
from app.services import push
from app.services.event_filters import visible_events
from app.services.pagination import keyset_before
from app.services.preferences import channel_enabled

_Actor = aliased(User)

ACTOR_EMAIL_WINDOW = timedelta(hours=24)
# An invitation withdrawn and sent again inside this window raises no second notification: the
# first row in the feed offers the answer again while the invitation is pending.
REINVITE_QUIET_PERIOD = timedelta(days=7)


def _actor_email_capped(db: Session, actor_id: uuid.UUID) -> bool:
    queued = (
        db.query(func.count(NotificationDelivery.id))
        .join(Notification, NotificationDelivery.notification_id == Notification.id)
        .filter(
            Notification.actor_id == actor_id,
            NotificationDelivery.channel == "email",
            NotificationDelivery.created_at >= datetime.now(UTC) - ACTOR_EMAIL_WINDOW,
        )
        .scalar()
    )
    return (queued or 0) >= settings.notification_email_daily_cap_per_actor


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
        "email": has_verified_email(recipient)
        and (actor_id is None or not _actor_email_capped(db, actor_id)),
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
    """Tell ``invitee_id`` that the owner of ``event`` invites them to share its credit.

    Silent when an invitation to the same event reached them within
    :data:`REINVITE_QUIET_PERIOD`, so a withdraw and invite loop sends one notification.
    """
    recent = (
        db.query(Notification.id)
        .filter(
            Notification.user_id == invitee_id,
            Notification.kind == "co_geolocator_invite",
            Notification.event_id == event.id,
            Notification.created_at >= datetime.now(UTC) - REINVITE_QUIET_PERIOD,
        )
        .first()
    )
    if recent is not None:
        return
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


def notify_approval_received(
    db: Session,
    *,
    event: Event,
    reviewer_id: uuid.UUID,
    organization_id: uuid.UUID | None = None,
    requester_ids: Collection[uuid.UUID] = (),
) -> None:
    """Tell the owner of ``event``, and every geolocator whose review request the approval
    resolved (``requester_ids``), that ``reviewer_id`` approved its live version, for
    ``organization_id`` when set."""
    for recipient_id in {event.owner_id, *requester_ids}:
        _emit(
            db,
            recipient_id=recipient_id,
            kind="approval_received",
            actor_id=reviewer_id,
            event_id=event.id,
            organization_id=organization_id,
        )


def _ever_credited_ids(db: Session, event: Event) -> set[uuid.UUID]:
    """The analysts who hold or held credit on ``event``: none of them approves it, so none is
    asked to on an organization's behalf."""
    current = db.scalars(
        select(EventGeolocator.user_id).where(EventGeolocator.event_id == event.id)
    )
    former = db.scalars(
        select(EventGeolocatorDeparture.user_id).where(
            EventGeolocatorDeparture.event_id == event.id
        )
    )
    return {event.owner_id, *current, *former}


def notify_review_request_received(
    db: Session,
    *,
    event: Event,
    requester_id: uuid.UUID,
    recipient_ids: Collection[uuid.UUID],
    organization_id: uuid.UUID | None = None,
) -> None:
    """Tell the target that ``requester_id`` asks them to review ``event``: one analyst, or the
    org-admins of ``organization_id`` who never held credit on it."""
    credited = _ever_credited_ids(db, event) if organization_id is not None else set()
    for recipient_id in set(recipient_ids) - credited:
        _emit(
            db,
            recipient_id=recipient_id,
            kind="review_request_received",
            actor_id=requester_id,
            event_id=event.id,
            organization_id=organization_id,
        )


def notify_review_request_declined(
    db: Session,
    *,
    event: Event,
    requester_id: uuid.UUID,
    target_id: uuid.UUID,
    organization_id: uuid.UUID | None = None,
) -> None:
    """Tell ``requester_id`` that ``target_id`` declined to review ``event``, for
    ``organization_id`` when set."""
    _emit(
        db,
        recipient_id=requester_id,
        kind="review_request_declined",
        actor_id=target_id,
        event_id=event.id,
        organization_id=organization_id,
    )


def notify_re_approve_requested(
    db: Session, *, event: Event, editor_id: uuid.UUID, superseded_version: int
) -> None:
    """Ask every analyst whose own approval of ``superseded_version`` stood to review the new
    one, and every live org-admin outside the event's current and former geolocators of an
    organization whose approval of it stood.

    A revoked approval asks nothing.
    """
    # Imported here: services/organizations imports this module.
    from app.services.organizations import live_admin_ids

    recipients: list[tuple[uuid.UUID, uuid.UUID | None]] = []
    for reviewer_id, organization_id in db.execute(
        select(EventApproval.reviewer_id, EventApproval.organization_id).where(
            EventApproval.event_id == event.id,
            EventApproval.version_no == superseded_version,
            EventApproval.revoked_at.is_(None),
        )
    ).tuples():
        if organization_id is None:
            assert reviewer_id is not None  # ck_event_approvals_reviewer
            recipients.append((reviewer_id, None))
        else:
            recipients.extend(
                (admin_id, organization_id)
                for admin_id in db.scalars(live_admin_ids(organization_id))
            )
    credited = _ever_credited_ids(db, event)
    recipients = [(r, org) for r, org in recipients if org is None or r not in credited]
    for recipient_id, organization_id in recipients:
        _emit(
            db,
            recipient_id=recipient_id,
            kind="re_approve_requested",
            actor_id=editor_id,
            event_id=event.id,
            organization_id=organization_id,
        )


def _visible_rows(db: Session, user: User) -> Query[Notification]:
    """``user``'s rows whose event and actor a reader may still see: the actor is neither
    soft-deleted nor deactivated, the rule the drain applies to the recipient."""
    return (
        db.query(Notification)
        .outerjoin(Event, Notification.event_id == Event.id)
        .outerjoin(_Actor, Notification.actor_id == _Actor.id)
        .filter(
            Notification.user_id == user.id,
            or_(Notification.event_id.is_(None), and_(*visible_events())),
            or_(
                Notification.actor_id.is_(None),
                and_(_Actor.deleted_at.is_(None), _Actor.is_active.is_(True)),
            ),
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


def _newest_rows(
    db: Session, *, user: User, kind: NotificationKind, rows: list[Notification], by: tuple
) -> set[uuid.UUID]:
    """The ids of ``user``'s newest ``kind`` row per key ``by``, over the whole feed, for the
    events ``rows`` name. Only the newest row of a key answers: an older one stands for an
    invitation or a request already answered."""
    event_ids = {r.event_id for r in rows if r.kind == kind and r.event_id}
    if not event_ids:
        return set()
    return set(
        db.scalars(
            select(Notification.id)
            .where(
                Notification.user_id == user.id,
                Notification.kind == kind,
                Notification.event_id.in_(event_ids),
            )
            .order_by(*by, Notification.created_at.desc(), Notification.id.desc())
            .distinct(*by)
        )
    )


def pending_invites(db: Session, *, user: User, rows: list[Notification]) -> set[uuid.UUID]:
    """The ``co_geolocator_invite`` rows among ``rows`` that offer an answer: the newest row of
    an event whose invitation still waits for ``user``."""
    newest = _newest_rows(
        db, user=user, kind="co_geolocator_invite", rows=rows, by=(Notification.event_id,)
    )
    if not newest:
        return set()
    waiting = set(
        db.scalars(
            select(EventGeolocatorInvite.event_id).where(
                EventGeolocatorInvite.user_id == user.id,
                EventGeolocatorInvite.event_id.in_(
                    {r.event_id for r in rows if r.id in newest and r.event_id}
                ),
            )
        )
    )
    return {r.id for r in rows if r.id in newest and r.event_id in waiting}


def _administered(db: Session, *, user: User, rows: list[Notification]) -> set[uuid.UUID]:
    """The organizations named by ``rows`` that ``user`` is an org-admin of now."""
    org_ids = {r.organization_id for r in rows if r.organization_id is not None}
    if not org_ids:
        return set()
    return set(
        db.scalars(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.role == "admin",
                OrganizationMember.organization_id.in_(org_ids),
            )
        )
    )


# A review request's key in the feed: the event, the requester, and the organization it targets
# (None for one addressed to the reader). There is one open request per requester, target and
# event.
RequestKey = tuple[uuid.UUID, uuid.UUID, uuid.UUID | None]


def open_review_requests(
    db: Session, *, user: User, rows: list[Notification]
) -> dict[uuid.UUID, uuid.UUID]:
    """The open review request behind each of ``rows``' ``review_request_received`` rows, by
    notification id: one addressed to ``user``, or to an organization ``user`` is an org-admin
    of now. Only the newest row of a key carries it; an older one stands for a request already
    answered."""
    received = [r for r in rows if r.kind == "review_request_received" and r.event_id]
    if not received:
        return {}
    event_ids = {r.event_id for r in received}
    org_ids = _administered(db, user=user, rows=received)
    found = db.execute(
        select(
            ReviewRequest.event_id,
            ReviewRequest.requester_id,
            ReviewRequest.target_organization_id,
            ReviewRequest.id,
        ).where(
            or_(
                ReviewRequest.target_user_id == user.id,
                ReviewRequest.target_organization_id.in_(org_ids),
            ),
            ReviewRequest.status == "open",
            ReviewRequest.event_id.in_(event_ids),
        )
    ).tuples()
    by_key: dict[RequestKey, uuid.UUID] = {
        (event_id, requester_id, org_id): request_id
        for event_id, requester_id, org_id, request_id in found
    }
    newest = _newest_rows(
        db,
        user=user,
        kind="review_request_received",
        rows=received,
        by=(Notification.event_id, Notification.actor_id, Notification.organization_id),
    )
    return {
        r.id: request_id
        for r in received
        if r.id in newest
        and r.actor_id is not None
        and r.event_id is not None
        and (request_id := by_key.get((r.event_id, r.actor_id, r.organization_id))) is not None
    }


# The kinds whose feed row offers to approve the event's live version.
_APPROVE_OFFER_KINDS: frozenset[NotificationKind] = frozenset(
    {"re_approve_requested", "review_request_received"}
)

# An approval offer's key: the event, and the organization the reader would approve for (None
# for their own approval).
OfferKey = tuple[uuid.UUID, uuid.UUID | None]


class ReapprovalOffer(NamedTuple):
    """What a re-approval row offers: the live version to approve, and the latest earlier
    version the approval (the reader's own, or the organization's) still stands on, the base of
    the change list."""

    live_version: int
    approved_version: int | None


def reapproval_offers(
    db: Session, *, user: User, rows: list[Notification]
) -> dict[OfferKey, ReapprovalOffer]:
    """The offer of each event among ``rows``' re-approval and review requests that ``user``
    can approve now, as themselves or for the organization the row names: published, never
    credited to them, and not yet approved at the live version (by them, or by the organization,
    which they must still administer).

    Callers eager-load ``Notification.event``.
    """
    administered = _administered(db, user=user, rows=rows)
    candidates: dict[OfferKey, int] = {
        (r.event.id, r.organization_id): r.event.version_no
        for r in rows
        if r.kind in _APPROVE_OFFER_KINDS
        and r.event is not None
        and r.event.status == STATUS_GEOLOCATED
        and r.event.owner_id != user.id
        and (r.organization_id is None or r.organization_id in administered)
    }
    if not candidates:
        return {}
    event_ids = {event_id for event_id, _ in candidates}
    credited = set(
        db.scalars(
            select(EventGeolocator.event_id).where(
                EventGeolocator.user_id == user.id,
                EventGeolocator.event_id.in_(event_ids),
            )
        )
    ) | set(
        db.scalars(
            select(EventGeolocatorDeparture.event_id).where(
                EventGeolocatorDeparture.user_id == user.id,
                EventGeolocatorDeparture.event_id.in_(event_ids),
            )
        )
    )
    blocked: set[OfferKey] = set()
    standing: dict[OfferKey, int] = {}
    for event_id, org_id, version, revoked_at in db.execute(
        select(
            EventApproval.event_id,
            EventApproval.organization_id,
            EventApproval.version_no,
            EventApproval.revoked_at,
        ).where(
            EventApproval.event_id.in_(event_ids),
            or_(
                and_(
                    EventApproval.reviewer_id == user.id,
                    EventApproval.organization_id.is_(None),
                ),
                EventApproval.organization_id.in_(administered),
            ),
        )
    ).tuples():
        key = (event_id, org_id)
        live = candidates.get(key)
        if live is None:
            continue
        # An analyst reviews a version once, revoked included; an organization's revoked
        # approval can be placed again.
        if version == live and (org_id is None or revoked_at is None):
            blocked.add(key)
        # Mirrored by the frontend's lib/approvals.standingApprovalBefore; change both.
        if revoked_at is None and version < live:
            standing[key] = max(version, standing.get(key, 0))
    return {
        key: ReapprovalOffer(version, standing.get(key))
        for key, version in candidates.items()
        if key[0] not in credited and key not in blocked
    }


def build_read(
    row: Notification,
    *,
    pending: set[uuid.UUID],
    offers: dict[OfferKey, ReapprovalOffer],
    review_requests: dict[uuid.UUID, uuid.UUID],
) -> NotificationRead:
    review_request_id = review_requests.get(row.id)
    # A resolved review request offers nothing, though the event may still be approvable.
    offers_approval = row.kind == "re_approve_requested" or review_request_id is not None
    offer = (
        offers.get((row.event_id, row.organization_id))
        if offers_approval and row.event_id is not None
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
        invite_pending=row.id in pending,
        reapprove_version=offer.live_version if offer is not None else None,
        approved_version=(
            offer.approved_version
            if offer is not None and row.kind == "re_approve_requested"
            else None
        ),
        review_request_id=review_request_id,
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
