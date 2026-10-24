"""Shared credit on a published event: invitations, removals and the erasure hand-over.

The owner of a ``geolocated`` event invites another analyst, who accepts or declines. A pending
invitation is an ``event_geolocator_invites`` row; accepting deletes it and inserts the
``event_geolocators`` row in one transaction. Credit carries no write right: editing, filing a
version and closing stay with the owner (``permissions.ensure_owner``).

Every write here locks the event row first, the way the lifecycle verbs do, so an invitation, an
answer and an erasure hand-over on the same event serialize.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.approval import EventApproval
from app.models.approval_request import ApprovalRequest
from app.models.collection import Collection, CollectionEvent
from app.models.event import (
    STATUS_GEOLOCATED,
    Event,
    EventGeolocator,
    EventGeolocatorDeparture,
    EventGeolocatorInvite,
)
from app.models.user import User
from app.schemas.user import AuthorRef
from app.services import notifications
from app.services.event_filters import lock_event
from app.services.permissions import ensure_owner
from app.services.users import get_live_by_username

# Every relationship ``build_event_read`` and ``build_event_list`` read for the credit line.
CREDIT_LOAD = selectinload(Event.geolocators).joinedload(EventGeolocator.user)

# Geolocators plus pending invitations, per event. Bounds the byline every card prints.
MAX_EVENT_GEOLOCATORS = 10


class GeolocatorCreditError(Exception):
    """A credit write the rules refuse, with a stable ``code``."""

    code: str


class EventNotPublishedError(GeolocatorCreditError):
    code = "invalid_state"


class InviteeNotFoundError(GeolocatorCreditError):
    code = "user_not_found"


class AlreadyGeolocatorError(GeolocatorCreditError):
    code = "already_geolocator"


class AlreadyInvitedError(GeolocatorCreditError):
    code = "already_invited"


class TooManyGeolocatorsError(GeolocatorCreditError):
    code = "too_many_geolocators"


class InviteNotFoundError(GeolocatorCreditError):
    code = "invite_not_found"


class GeolocatorNotFoundError(GeolocatorCreditError):
    code = "geolocator_not_found"


class OwnerCannotLeaveError(GeolocatorCreditError):
    code = "owner_cannot_leave"


GEOLOCATOR_CREDIT_ERROR_STATUS: dict[str, int] = {
    "invalid_state": 409,
    "user_not_found": 404,
    "already_geolocator": 409,
    "already_invited": 409,
    "too_many_geolocators": 409,
    "invite_not_found": 404,
    "geolocator_not_found": 404,
    "owner_cannot_leave": 409,
}


def live_geolocators(geo: Event) -> list[AuthorRef]:
    """``geo``'s credited geolocators, oldest first, soft-deleted ones dropped.

    A banned account must not surface on a live event owned by someone else, as with
    ``requested_by``. Callers eager-load :data:`CREDIT_LOAD`.
    """
    return [AuthorRef.model_validate(g.user) for g in geo.geolocators if g.user.deleted_at is None]


def _require_published(geo: Event) -> None:
    # Mirrored by the frontend's useEventActions (credit controls on geolocated only); change both.
    if geo.status != STATUS_GEOLOCATED:
        raise EventNotPublishedError("Only a published geolocation shares its credit")


def _invite_row(db: Session, event_id: uuid.UUID, user_id: uuid.UUID) -> EventGeolocatorInvite:
    row = db.get(EventGeolocatorInvite, (event_id, user_id))
    if row is None:
        raise InviteNotFoundError("No pending invitation")
    return row


def has_pending_invite(db: Session, *, event_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return db.get(EventGeolocatorInvite, (event_id, user_id)) is not None


def list_invites(db: Session, *, geo: Event, viewer: User) -> list[EventGeolocatorInvite]:
    """The pending invitations on ``geo`` that ``viewer`` may see, oldest first.

    The owner sees every one; anyone else sees only their own. An invitee whose account is
    soft-deleted is left out.
    """
    query = (
        db.query(EventGeolocatorInvite)
        .join(User, User.id == EventGeolocatorInvite.user_id)
        .options(joinedload(EventGeolocatorInvite.user))
        .filter(EventGeolocatorInvite.event_id == geo.id, User.deleted_at.is_(None))
    )
    if geo.owner_id != viewer.id:
        query = query.filter(EventGeolocatorInvite.user_id == viewer.id)
    return query.order_by(EventGeolocatorInvite.created_at).all()


def invite(db: Session, *, geo: Event, owner: User, username: str) -> EventGeolocatorInvite:
    """Invite ``username`` to share the credit of ``geo`` and notify them.

    Owner-only (403) and ``geolocated`` only (409 ``invalid_state``). An unknown or
    soft-deleted username is 404 ``user_not_found``; a current geolocator, the owner included,
    409 ``already_geolocator``; a pending invitation 409 ``already_invited``; past
    :data:`MAX_EVENT_GEOLOCATORS` 409 ``too_many_geolocators``.
    """
    geo = lock_event(db, geo.id)
    ensure_owner(geo, owner)
    _require_published(geo)
    invitee = get_live_by_username(db, username)
    if invitee is None:
        raise InviteeNotFoundError("No analyst with that username")
    if db.get(EventGeolocator, (geo.id, invitee.id)) is not None or invitee.id == geo.owner_id:
        raise AlreadyGeolocatorError("This analyst is already a geolocator of this event")
    if db.get(EventGeolocatorInvite, (geo.id, invitee.id)) is not None:
        raise AlreadyInvitedError("This analyst already has a pending invitation")
    # Live analysts only: a banned co-geolocator or invitee prints on no byline.
    credited = db.scalar(
        select(func.count())
        .select_from(EventGeolocator)
        .join(User, User.id == EventGeolocator.user_id)
        .where(EventGeolocator.event_id == geo.id, User.deleted_at.is_(None))
    )
    pending = db.scalar(
        select(func.count())
        .select_from(EventGeolocatorInvite)
        .join(User, User.id == EventGeolocatorInvite.user_id)
        .where(EventGeolocatorInvite.event_id == geo.id, User.deleted_at.is_(None))
    )
    if (credited or 0) + (pending or 0) >= MAX_EVENT_GEOLOCATORS:
        raise TooManyGeolocatorsError(
            f"An event carries at most {MAX_EVENT_GEOLOCATORS} geolocators and invitations"
        )
    row = EventGeolocatorInvite(event_id=geo.id, user_id=invitee.id)
    db.add(row)
    notifications.notify_co_geolocator_invite(db, event=geo, invitee_id=invitee.id)
    db.commit()
    db.refresh(row)
    return row


def withdraw(db: Session, *, geo: Event, owner: User, username: str) -> None:
    """Withdraw the owner's pending invitation of ``username`` (404 ``invite_not_found``)."""
    geo = lock_event(db, geo.id)
    ensure_owner(geo, owner)
    invitee = get_live_by_username(db, username)
    if invitee is None:
        raise InviteNotFoundError("No pending invitation")
    db.delete(_invite_row(db, geo.id, invitee.id))
    db.commit()


def accept(db: Session, *, geo: Event, user: User) -> Event:
    """Turn ``user``'s pending invitation into geolocator credit, in one transaction. The open
    approval requests asking ``user`` to approve the event go, since a geolocator cannot approve it.

    404 ``invite_not_found`` without one; 409 ``invalid_state`` once the event left
    ``geolocated`` (the invitation stays, and declining it still works).
    """
    geo = lock_event(db, geo.id)
    invitation = _invite_row(db, geo.id, user.id)
    _require_published(geo)
    db.delete(invitation)
    db.add(EventGeolocator(event_id=geo.id, user_id=user.id))
    delete_approvals_on_join(db, geo=geo, user=user)
    db.execute(
        delete(ApprovalRequest).where(
            ApprovalRequest.event_id == geo.id,
            ApprovalRequest.target_user_id == user.id,
            ApprovalRequest.status == "open",
        )
    )
    db.commit()
    db.refresh(geo)
    return geo


def decline(db: Session, *, geo: Event, user: User) -> None:
    """Drop ``user``'s pending invitation (404 ``invite_not_found``)."""
    geo = lock_event(db, geo.id)
    db.delete(_invite_row(db, geo.id, user.id))
    db.commit()


def delete_approvals_on_join(db: Session, *, geo: Event, user: User) -> None:
    """Delete every approval ``user`` gave ``geo``: a geolocator cannot approve their own event.

    Every version, not only the live one, since the reviewer is no longer independent of the
    work, and the approvals they placed for an organization too. The notifications that reported
    them go with them. Staged in the caller's transaction.
    """
    db.execute(
        delete(EventApproval).where(
            EventApproval.event_id == geo.id,
            EventApproval.reviewer_id == user.id,
        )
    )


def remove(db: Session, *, geo: Event, actor: User, username: str) -> None:
    """Take ``username``'s credit off ``geo``: the owner removes a co-geolocator, or one leaves.

    The owner cannot leave (409 ``owner_cannot_leave``); anyone else removing someone else is
    403. A removed analyst's collections drop the event in the same transaction, since a
    collection holds only credited work, and an ``event_geolocator_departures`` row records the
    departure, so they never approve the event. The open approval requests they sent about the
    event are withdrawn, since only a geolocator asks for one; they keep counting toward the
    daily cap. The owner's removal notifies the analyst
    removed.
    """
    geo = lock_event(db, geo.id)
    target = db.query(User).filter(User.username == username).first()
    if target is None or db.get(EventGeolocator, (geo.id, target.id)) is None:
        raise GeolocatorNotFoundError("This analyst is not a geolocator of this event")
    if target.id == geo.owner_id:
        raise OwnerCannotLeaveError("The owner stays a geolocator of their event")
    if target.id != actor.id:
        ensure_owner(geo, actor)
        notifications.notify_co_geolocator_removed(db, event=geo, removed_id=target.id)
    db.execute(
        delete(EventGeolocator).where(
            EventGeolocator.event_id == geo.id, EventGeolocator.user_id == target.id
        )
    )
    db.execute(
        insert(EventGeolocatorDeparture)
        .values(event_id=geo.id, user_id=target.id, created_at=datetime.now(UTC))
        .on_conflict_do_nothing(index_elements=["event_id", "user_id"])
    )
    db.execute(
        update(ApprovalRequest)
        .where(
            ApprovalRequest.event_id == geo.id,
            ApprovalRequest.requester_id == target.id,
            ApprovalRequest.status == "open",
        )
        .values(status="withdrawn", resolved_at=datetime.now(UTC))
    )
    db.execute(
        delete(CollectionEvent).where(
            CollectionEvent.event_id == geo.id,
            CollectionEvent.collection_id.in_(
                select(Collection.id).where(Collection.owner_id == target.id)
            ),
        )
    )
    db.commit()


def hand_over_owned_events(db: Session, *, owner: User, events: Sequence[Event]) -> set[uuid.UUID]:
    """Pass each live one of ``events`` that another live analyst is credited on to the earliest
    of them.

    The step of ``admin.soft_delete_user`` and ``admin.hard_delete_user`` that keeps shared
    work published: the heir becomes ``owner_id`` and receives an ``ownership_transferred``
    notification, which names no actor. A soft-deleted co-geolocator is skipped. An event
    soft-deleted with ``owner``'s own ban (its ``deleted_at`` is the owner's) counts as live and
    is restored on hand-over; one soft-deleted on its own never passes, so the erasure purges it
    with its media. Returns the ids handed over; the caller deletes or hides the rest. Does not
    commit.
    """
    banned_with_owner = owner.deleted_at
    live = [
        geo
        for geo in events
        if geo.deleted_at is None
        or (banned_with_owner is not None and geo.deleted_at == banned_with_owner)
    ]
    if not live:
        return set()
    heirs = db.execute(
        select(EventGeolocator.event_id, EventGeolocator.user_id)
        .join(User, User.id == EventGeolocator.user_id)
        .where(
            EventGeolocator.event_id.in_([geo.id for geo in live]),
            EventGeolocator.user_id != owner.id,
            User.deleted_at.is_(None),
        )
        .order_by(EventGeolocator.event_id, EventGeolocator.created_at, EventGeolocator.user_id)
        .distinct(EventGeolocator.event_id)
    ).all()
    heir_by_event = {event_id: user_id for event_id, user_id in heirs}
    for geo in live:
        heir_id = heir_by_event.get(geo.id)
        if heir_id is None:
            continue
        geo.owner_id = heir_id
        geo.deleted_at = None
        notifications.notify_ownership_transferred(db, event=geo, heir_id=heir_id)
    return set(heir_by_event)
