"""Approvals: an analyst, or an organization through any of its members, attests that one
version of a published event holds.

An approval binds to ``(event_id, version_no)``. It is current while that version is the live
one and nobody revoked it, so a new version ends every approval without a write here
(``services/versions.file_version`` notifies the reviewers, and an organization's members).
Placing one locks the event row and compares the version the client read with the live one, so
an approval never lands on a version its reviewer did not see.

The event's geolocators (its owner and every credited co-geolocator) cannot approve it, neither
as themselves nor for an organization, and neither can a former co-geolocator, removed or gone. Accepting a co-geolocator invitation revokes the
invitee's approvals (``geolocator_credit.revoke_approvals_on_join``). A reviewer who revoked their
own approval may approve that version again in a new row; a revocation by anyone else closes the
version to them (:func:`closes_review`). Any member of an organization revokes its approval in one
click, and the organization may approve again unless a site admin revoked it. A member who leaves
or is removed leaves the organization's past approvals as they are. An approval resolves every
open approval request its target (the analyst, or the organization) received for the event, and
the requesters hear of it as the owner does.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, Select, and_, or_, select, update
from sqlalchemy.orm import Session, joinedload

from app.models.approval import JOINED_AS_GEOLOCATOR_REASON, ApprovalRevoker, EventApproval
from app.models.approval_request import ApprovalRequest
from app.models.event import (
    STATUS_GEOLOCATED,
    Event,
    EventGeolocator,
    EventGeolocatorDeparture,
)
from app.models.organization import Organization
from app.models.user import User
from app.schemas.approval import ApprovalRead, OrganizationApprovalRead
from app.schemas.notification import NotificationEventRef
from app.schemas.organization import OrganizationRef
from app.schemas.user import AuthorRef
from app.services import notifications
from app.services.admin import log_admin_event
from app.services.event_filters import visible_events
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


class ReapprovalRefusedError(ApprovalError):
    code = "reapproval_refused"


class ApprovalNotFoundError(ApprovalError):
    code = "approval_not_found"


class AlreadyRevokedError(ApprovalError):
    code = "already_revoked"


class RevokeForbiddenError(ApprovalError):
    code = "revoke_forbidden"


class OrganizationNotFoundError(ApprovalError):
    code = "organization_not_found"


class NotOrganizationMemberError(ApprovalError):
    code = "not_organization_member"


APPROVAL_ERROR_STATUS: dict[str, int] = {
    "invalid_state": 409,
    "version_mismatch": 409,
    "geolocator_cannot_approve": 403,
    "already_approved": 409,
    "reapproval_refused": 409,
    "approval_not_found": 404,
    "already_revoked": 409,
    "revoke_forbidden": 403,
    "organization_not_found": 404,
    "not_organization_member": 403,
}


def _lock(db: Session, event_id: uuid.UUID) -> Event:
    return db.query(Event).filter(Event.id == event_id).populate_existing().with_for_update().one()


def is_geolocator(db: Session, *, geo: Event, user_id: uuid.UUID) -> bool:
    """Whether ``user_id`` is credited on ``geo``: its owner or an accepted co-geolocator."""
    return geo.owner_id == user_id or db.get(EventGeolocator, (geo.id, user_id)) is not None


def former_geolocator_ids(event_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """The analysts who held credit on the event and lost it."""
    return select(EventGeolocatorDeparture.user_id).where(
        EventGeolocatorDeparture.event_id == event_id
    )


def ever_credited(db: Session, *, geo: Event, user_id: uuid.UUID) -> bool:
    """Whether ``user_id`` holds or held credit on ``geo``: such an analyst neither approves it
    nor is asked to approve it."""
    return (
        is_geolocator(db, geo=geo, user_id=user_id)
        or db.get(EventGeolocatorDeparture, (geo.id, user_id)) is not None
    )


def may_approve(db: Session, *, geo: Event, user: User | None) -> bool:
    """Whether ``user`` may approve ``geo`` at all, as themselves or for an organization: signed
    in, the event published, and never credited on it. ``approve`` also checks the version and
    an earlier review of it."""
    return (
        user is not None
        and geo.status == STATUS_GEOLOCATED
        and not ever_credited(db, geo=geo, user_id=user.id)
    )


def closes_review(*, organization: bool) -> ColumnElement[bool]:
    """The reviews (``EventApproval``) that close their version to another review by the same
    analyst, or for the same organization: one that stands, or one revoked by anyone but its own
    side. An analyst's self-revoke reopens the version, unless it was the revocation stamped when
    they joined the geolocators. An organization's approval revoked by one of its members reopens
    it; one revoked by a site admin does not. Mirrored by the frontend's
    lib/approvals.closesReview; change both."""
    if organization:
        return or_(EventApproval.revoked_at.is_(None), EventApproval.revoked_as == "site_admin")
    return or_(
        EventApproval.revoked_at.is_(None),
        EventApproval.revoked_as != "reviewer",
        EventApproval.revoke_reason == JOINED_AS_GEOLOCATOR_REASON,
    )


def closed_reviewer_ids(geo: Event) -> Select[tuple[uuid.UUID | None]]:
    """The analysts the live version of ``geo`` is closed to as reviewers (:func:`closes_review`)."""
    return select(EventApproval.reviewer_id).where(
        EventApproval.event_id == geo.id,
        EventApproval.version_no == geo.version_no,
        EventApproval.organization_id.is_(None),
        closes_review(organization=False),
    )


def closed_organization_ids(geo: Event) -> Select[tuple[uuid.UUID | None]]:
    """The organizations the live version of ``geo`` is closed to (:func:`closes_review`)."""
    return select(EventApproval.organization_id).where(
        EventApproval.event_id == geo.id,
        EventApproval.version_no == geo.version_no,
        EventApproval.organization_id.is_not(None),
        closes_review(organization=True),
    )


def build_read(row: EventApproval, *, live_version: int) -> ApprovalRead:
    """``current`` holds while the approval covers the live version of a published event: a
    closed event keeps its approvals readable, none of them current."""
    return ApprovalRead(
        id=row.id,
        version_no=row.version_no,
        verdict=row.verdict,
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
        note=row.note,
        created_at=row.created_at,
        current=row.version_no == live_version
        and row.revoked_at is None
        and row.event.status == STATUS_GEOLOCATED,
        revoked_at=row.revoked_at,
        revoke_reason=row.revoke_reason,
        revoked_as=row.revoked_as,
    )


def resolve_organization(db: Session, slug: str) -> Organization:
    """The organization an approval is placed for, or 404 ``organization_not_found``."""
    org = db.query(Organization).filter(Organization.slug == slug).first()
    if org is None:
        raise OrganizationNotFoundError("Organization not found")
    return org


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
    """The reviews of ``geo``, by version then oldest first, revoked ones included.

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
    note: str | None,
    organization: Organization | None = None,
) -> EventApproval:
    """Approve the live version of ``geo`` as ``reviewer``, or for ``organization`` with
    ``reviewer`` as the acting member. Resolve the approval requests that target received for
    the event, and notify the owner and those requesters.

    409 ``invalid_state`` off ``geolocated`` (a closed event keeps its approvals readable but
    takes no new one); 403 ``not_organization_member`` when ``reviewer`` is not a member of
    ``organization``; 403 ``geolocator_cannot_approve`` for a current or former geolocator of the event; 409
    ``version_mismatch`` when ``version_no`` is not the live version; 409 ``already_approved``
    when the approval ``reviewer``, or ``organization``, gave that version stands; 409
    ``reapproval_refused`` when a revocation closed the version to them (:func:`closes_review`).
    A self-revoked approval stays as history beside the new row.
    """
    geo = _lock(db, geo.id)
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
        if mine.filter(EventApproval.revoked_at.is_(None)).first() is not None:
            raise AlreadyApprovedError("You already approved this version")
        if mine.filter(closes_review(organization=False)).first() is not None:
            raise ReapprovalRefusedError(
                "Your approval of this version was revoked; you cannot approve it again"
            )
        target = ApprovalRequest.target_user_id == reviewer.id
    else:
        theirs = same_version.filter(EventApproval.organization_id == organization.id)
        if theirs.filter(EventApproval.revoked_at.is_(None)).first() is not None:
            raise AlreadyApprovedError(f"{organization.name} already approved this version")
        if theirs.filter(closes_review(organization=True)).first() is not None:
            raise ReapprovalRefusedError(
                f"A site admin revoked {organization.name}'s approval of this version"
            )
        target = ApprovalRequest.target_organization_id == organization.id
    row = EventApproval(
        event_id=geo.id,
        version_no=version_no,
        reviewer_id=reviewer.id,
        organization_id=organization.id if organization is not None else None,
        note=note,
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


def _revoker_role(db: Session, row: EventApproval, actor: User) -> ApprovalRevoker:
    """The role ``actor`` revokes ``row`` in, or 403 ``revoke_forbidden``.

    An analyst's approval: its reviewer, then a site admin. An organization's approval: its
    current members (its reviewer among them), then a site admin. A reviewer who left the
    organization no longer acts in its name.
    """
    if row.organization_id is None:
        if row.reviewer_id == actor.id:
            return "reviewer"
    elif is_organization_member(db, org_id=row.organization_id, user_id=actor.id):
        return "reviewer" if row.reviewer_id == actor.id else "organization_member"
    if actor.is_admin:
        return "site_admin"
    raise RevokeForbiddenError(
        "Only the reviewer or a site admin can revoke this approval"
        if row.organization_id is None
        else "Only a member of the organization or a site admin can revoke this approval"
    )


def revoke(
    db: Session,
    *,
    geo: Event,
    approval_id: uuid.UUID,
    actor: User,
    reason: str | None = None,
) -> EventApproval:
    """Revoke one approval of ``geo``, with an optional public ``reason``, and notify the owner.

    The reviewer revokes their own; a member revokes any approval placed for their organization;
    a site admin revokes any, which writes an ``admin_events`` row. Anyone else is
    403 ``revoke_forbidden``. 404 ``approval_not_found`` for an id that is not an approval of
    ``geo``; 409 ``already_revoked`` for one already revoked.
    """
    geo = _lock(db, geo.id)
    row = (
        db.query(EventApproval)
        .options(joinedload(EventApproval.reviewer), joinedload(EventApproval.organization))
        .filter(EventApproval.id == approval_id, EventApproval.event_id == geo.id)
        .first()
    )
    if row is None:
        raise ApprovalNotFoundError("No such approval on this event")
    role = _revoker_role(db, row, actor)
    if row.revoked_at is not None:
        raise AlreadyRevokedError("This approval is already revoked")
    row.revoked_at = datetime.now(UTC)
    row.revoked_by_id = actor.id
    row.revoke_reason = reason
    row.revoked_as = role
    notifications.notify_approval_revoked(db, event=geo, approval=row)
    if role == "site_admin":
        log_admin_event(
            db,
            actor_id=actor.id,
            action="approval_revoked",
            target={
                "geolocation_id": str(geo.id),
                "approval_id": str(row.id),
                "reviewer_id": str(row.reviewer_id) if row.reviewer_id is not None else None,
                "organization_id": (
                    str(row.organization_id) if row.organization_id is not None else None
                ),
                "version_no": row.version_no,
            },
        )
    db.commit()
    db.refresh(row)
    return row


def list_for_organization(
    db: Session,
    *,
    org: Organization,
    limit: int,
    cursor: tuple[datetime, uuid.UUID] | None,
) -> list[EventApproval]:
    """One window of the approvals placed for ``org``, newest first, over-fetched by one row for
    ``take_page``. An approval of an event a public reader cannot see is left out; every other
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
