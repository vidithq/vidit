"""Approvals: an analyst, or an organization through any of its members, attests that one
version of a published event holds.

An approval binds to ``(event_id, version_no)``. It is current while that version is the live
one, so a new version ends every approval without a write here
(``services/versions.file_version`` notifies the reviewers, and an organization's members).
Placing one locks the event row and compares the version the client read with the live one, so
an approval never lands on a version its reviewer did not see.

The event's geolocators (its owner and every credited co-geolocator) cannot approve it, neither
as themselves nor for an organization, and neither can a former co-geolocator, removed or gone.

An approval is final: nobody revokes it. Two paths delete one. Accepting a co-geolocator
invitation deletes the invitee's approvals of the event
(``geolocator_credit.delete_approvals_on_join``), and a site admin deletes any approval
(:func:`delete_as_admin`), which writes an ``audit_log`` row. A member who leaves or is
removed leaves the organization's past approvals as they are. An approval resolves every open
approval request its target (the analyst, or the organization) received for the event, and the
requesters hear of it as the owner does.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, Select, and_, or_, select, update
from sqlalchemy.orm import Session, joinedload

from app.models.approval import EventApproval
from app.models.approval_request import ApprovalRequest
from app.models.event import (
    STATUS_GEOLOCATED,
    Event,
    EventGeolocator,
)
from app.models.organization import Organization
from app.models.user import User
from app.schemas.approval import ApprovalRead, OrganizationApprovalRead
from app.schemas.notification import NotificationEventRef
from app.schemas.organization import OrganizationRef
from app.schemas.user import AuthorRef
from app.services import notifications
from app.services.admin import log_admin_event
from app.services.event_filters import ever_credited_ids, lock_event, visible_events
from app.services.organizations import is_organization_member
from app.services.pagination import keyset_before


class ApprovalError(Exception):
    """An approval write the rules refuse, with a stable ``code``."""

    code: str


class EventNotApprovableError(ApprovalError):
    code = "invalid_state"


class VersionMismatchError(ApprovalError):
    code = "version_mismatch"


class GeolocatorCannotApproveError(ApprovalError):
    code = "geolocator_cannot_approve"


class AlreadyApprovedError(ApprovalError):
    code = "already_approved"


class ApprovalNotFoundError(ApprovalError):
    code = "approval_not_found"


class NotOrganizationMemberError(ApprovalError):
    code = "not_organization_member"


APPROVAL_ERROR_STATUS: dict[str, int] = {
    "invalid_state": 409,
    "version_mismatch": 409,
    "geolocator_cannot_approve": 403,
    "already_approved": 409,
    "approval_not_found": 404,
    "not_organization_member": 403,
}


def is_geolocator(db: Session, *, geo: Event, user_id: uuid.UUID) -> bool:
    """Whether ``user_id`` is credited on ``geo``: its owner or an accepted co-geolocator."""
    return geo.owner_id == user_id or db.get(EventGeolocator, (geo.id, user_id)) is not None


def ever_credited(db: Session, *, geo: Event, user_id: uuid.UUID) -> bool:
    """Whether ``user_id`` is in :func:`services.event_filters.ever_credited_ids` for ``geo``."""
    return user_id in db.scalars(ever_credited_ids(geo.id)).all()


def may_approve(db: Session, *, geo: Event, user: User | None) -> bool:
    """Whether ``user`` may approve ``geo`` at all, as themselves or for an organization: signed
    in, the event published, and never credited on it. ``approve`` also checks the version and
    an earlier review of it."""
    return (
        user is not None
        and geo.status == STATUS_GEOLOCATED
        and not ever_credited(db, geo=geo, user_id=user.id)
    )


def approved_reviewer_ids(geo: Event) -> Select[tuple[uuid.UUID | None]]:
    """The analysts who approved the live version of ``geo`` as themselves."""
    return select(EventApproval.reviewer_id).where(
        EventApproval.event_id == geo.id,
        EventApproval.version_no == geo.version_no,
        EventApproval.organization_id.is_(None),
    )


def approved_organization_ids(geo: Event) -> Select[tuple[uuid.UUID | None]]:
    """The organizations that approved the live version of ``geo``."""
    return select(EventApproval.organization_id).where(
        EventApproval.event_id == geo.id,
        EventApproval.version_no == geo.version_no,
        EventApproval.organization_id.is_not(None),
    )


def build_read(row: EventApproval, *, live_version: int) -> ApprovalRead:
    """``current`` holds while the approval covers the live version of a published event: a
    closed event keeps its approvals readable, none of them current."""
    return ApprovalRead(
        id=row.id,
        version_no=row.version_no,
        # An organization's approval stays the organization's: a reviewer erased or banned
        # since is not named.
        reviewer=(
            AuthorRef.model_validate(row.reviewer)
            if row.reviewer is not None and row.reviewer.deleted_at is None
            else None
        ),
        organization=(
            OrganizationRef.model_validate(row.organization)
            if row.organization is not None
            else None
        ),
        created_at=row.created_at,
        current=row.version_no == live_version and row.event.status == STATUS_GEOLOCATED,
    )


# One read returns at most this many reviews: far past any event's reviewers on one version,
# while bounding the read of an event approved over many versions.
MAX_APPROVALS_LISTED = 500


def _reviewer_shown() -> ColumnElement[bool]:
    """An organization's review, whatever became of the member who placed it, or an analyst's
    review whose reviewer is live. Callers outer-join ``User`` on ``reviewer_id``."""
    return or_(EventApproval.organization_id.is_not(None), User.deleted_at.is_(None))


def list_approvals(
    db: Session, *, geo: Event, version_no: int | None, reviewer: str | None
) -> list[EventApproval]:
    """The reviews of ``geo``, by version then oldest first.

    ``version_no`` keeps one version and ``reviewer`` one analyst's own reviews (by username,
    without those they placed for an organization); either may be omitted. A soft-deleted
    analyst's review is left out, as a soft-deleted geolocator is; an organization's review stays
    whatever became of the member who placed it. Past ``MAX_APPROVALS_LISTED`` the newest stay,
    so a read of every version keeps the live version's.
    """
    query = (
        db.query(EventApproval)
        .outerjoin(User, User.id == EventApproval.reviewer_id)
        .options(joinedload(EventApproval.reviewer), joinedload(EventApproval.organization))
        .filter(EventApproval.event_id == geo.id, _reviewer_shown())
    )
    if version_no is not None:
        query = query.filter(EventApproval.version_no == version_no)
    if reviewer is not None:
        query = query.filter(User.username == reviewer, EventApproval.organization_id.is_(None))
    newest = (
        query.order_by(
            EventApproval.version_no.desc(),
            EventApproval.created_at.desc(),
            EventApproval.id.desc(),
        )
        .limit(MAX_APPROVALS_LISTED)
        .all()
    )
    return newest[::-1]


def approve(
    db: Session,
    *,
    geo: Event,
    reviewer: User,
    version_no: int,
    organization: Organization | None = None,
) -> EventApproval:
    """Approve the live version of ``geo`` as ``reviewer``, or for ``organization`` with
    ``reviewer`` as the acting member. Resolve the approval requests that target received for
    the event, and notify the owner and those requesters.

    409 ``invalid_state`` off ``geolocated`` (a closed event keeps its approvals readable but
    takes no new one); 403 ``not_organization_member`` when ``reviewer`` is not a member of
    ``organization``; 403 ``geolocator_cannot_approve`` for a current or former geolocator of the event; 409
    ``version_mismatch`` when ``version_no`` is not the live version; 409 ``already_approved``
    when ``reviewer``, or ``organization``, already approved that version.
    """
    geo = lock_event(db, geo.id)
    # Mirrored by the frontend's lib/approvals.canApprove; change both.
    if geo.status != STATUS_GEOLOCATED:
        raise EventNotApprovableError("Only a published geolocation can be approved")
    if organization is not None and not is_organization_member(
        db, org_id=organization.id, user_id=reviewer.id
    ):
        raise NotOrganizationMemberError(
            "Only a member of the organization can approve in its name"
        )
    if ever_credited(db, geo=geo, user_id=reviewer.id):
        raise GeolocatorCannotApproveError(
            "A geolocator of this event, current or former, cannot approve it"
        )
    if version_no != geo.version_no:
        raise VersionMismatchError(
            f"This event is at version {geo.version_no}; reload it before approving"
        )
    same_version = db.query(EventApproval).filter(
        EventApproval.event_id == geo.id, EventApproval.version_no == version_no
    )
    if organization is None:
        # Mirrored by the frontend's lib/approvals.canApprove; change both.
        mine = same_version.filter(
            EventApproval.reviewer_id == reviewer.id, EventApproval.organization_id.is_(None)
        )
        if mine.first() is not None:
            raise AlreadyApprovedError("You already approved this version")
        target = ApprovalRequest.target_user_id == reviewer.id
    else:
        theirs = same_version.filter(EventApproval.organization_id == organization.id)
        if theirs.first() is not None:
            raise AlreadyApprovedError(f"{organization.name} already approved this version")
        target = ApprovalRequest.target_organization_id == organization.id
    row = EventApproval(
        event_id=geo.id,
        version_no=version_no,
        reviewer_id=reviewer.id,
        organization_id=organization.id if organization is not None else None,
    )
    db.add(row)
    requester_ids = db.scalars(
        update(ApprovalRequest)
        .where(ApprovalRequest.event_id == geo.id, target, ApprovalRequest.status == "open")
        .values(status="approved", resolved_at=datetime.now(UTC))
        .returning(ApprovalRequest.requester_id)
    ).all()
    notifications.notify_approval_received(db, event=geo, approval=row, requester_ids=requester_ids)
    db.commit()
    db.refresh(row)
    return row


def delete_as_admin(db: Session, *, approval_id: uuid.UUID, actor: User) -> None:
    """Delete one approval as a site admin and write an ``audit_log`` row. The notifications
    that reported it go with it. 404 ``approval_not_found`` for an unknown id. The caller checks
    that ``actor`` is a site admin."""
    event_id = db.scalar(select(EventApproval.event_id).where(EventApproval.id == approval_id))
    if event_id is None:
        raise ApprovalNotFoundError("No such approval")
    lock_event(db, event_id)
    row = db.get(EventApproval, approval_id)
    if row is None:
        raise ApprovalNotFoundError("No such approval")
    log_admin_event(
        db,
        actor_id=actor.id,
        action="approval_deleted",
        target={
            "geolocation_id": str(row.event_id),
            "approval_id": str(row.id),
            "reviewer_id": str(row.reviewer_id) if row.reviewer_id is not None else None,
            "organization_id": (
                str(row.organization_id) if row.organization_id is not None else None
            ),
            "version_no": row.version_no,
        },
    )
    db.delete(row)
    db.commit()


def list_for_organization(
    db: Session,
    *,
    org: Organization,
    limit: int,
    cursor: tuple[datetime, uuid.UUID] | None,
) -> list[EventApproval]:
    """One window of the approvals placed for ``org``, newest first, over-fetched by one row for
    ``pagination.paged``. An approval of an event a public reader cannot see is left out; every other
    stays whatever became of the member who placed it, as on the event page."""
    query = (
        db.query(EventApproval)
        .join(Event, and_(Event.id == EventApproval.event_id, *visible_events()))
        .outerjoin(User, User.id == EventApproval.reviewer_id)
        .options(
            joinedload(EventApproval.reviewer),
            joinedload(EventApproval.organization),
            joinedload(EventApproval.event),
        )
        .filter(EventApproval.organization_id == org.id, _reviewer_shown())
    )
    if cursor is not None:
        query = query.filter(keyset_before(EventApproval.created_at, EventApproval.id, cursor))
    return (
        query.order_by(EventApproval.created_at.desc(), EventApproval.id.desc())
        .limit(limit + 1)
        .all()
    )


def build_organization_read(row: EventApproval) -> OrganizationApprovalRead:
    return OrganizationApprovalRead(
        event=NotificationEventRef.model_validate(row.event),
        approval=build_read(row, live_version=row.event.version_no),
    )
