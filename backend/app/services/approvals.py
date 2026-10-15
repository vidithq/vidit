"""Approvals: an analyst attests that one version of a published event holds.

An approval binds to ``(event_id, version_no)``. It is current while that version is the live
one and nobody revoked it, so a new version ends every approval without a write here
(``services/versions.file_version`` notifies the reviewers). Placing one locks the event row
and compares the version the client read with the live one, so an approval never lands on a
version its reviewer did not see.

The event's geolocators (its owner and every credited co-geolocator) cannot approve it.
Accepting a co-geolocator invitation revokes the invitee's approvals
(``geolocator_credit.revoke_approvals_on_join``).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session, joinedload

from app.models.approval import EventApproval
from app.models.event import STATUS_GEOLOCATED, Event, EventGeolocator
from app.models.user import User
from app.schemas.approval import ApprovalRead
from app.schemas.user import AuthorRef
from app.services import notifications
from app.services.admin import log_admin_event


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


class AlreadyRevokedError(ApprovalError):
    code = "already_revoked"


class RevokeForbiddenError(ApprovalError):
    code = "revoke_forbidden"


APPROVAL_ERROR_STATUS: dict[str, int] = {
    "invalid_state": 409,
    "version_mismatch": 409,
    "geolocator_cannot_approve": 403,
    "already_approved": 409,
    "approval_not_found": 404,
    "already_revoked": 409,
    "revoke_forbidden": 403,
}


def _lock(db: Session, event_id: uuid.UUID) -> Event:
    return db.query(Event).filter(Event.id == event_id).populate_existing().with_for_update().one()


def _is_geolocator(db: Session, *, geo: Event, user_id: uuid.UUID) -> bool:
    """Whether ``user_id`` is credited on ``geo``: its owner or an accepted co-geolocator."""
    return geo.owner_id == user_id or db.get(EventGeolocator, (geo.id, user_id)) is not None


def build_read(row: EventApproval, *, live_version: int) -> ApprovalRead:
    return ApprovalRead(
        id=row.id,
        version_no=row.version_no,
        verdict=row.verdict,
        reviewer=AuthorRef.model_validate(row.reviewer),
        note=row.note,
        created_at=row.created_at,
        current=row.version_no == live_version and row.revoked_at is None,
        revoked_at=row.revoked_at,
        revoke_reason=row.revoke_reason,
        revoked_by_admin=row.revoked_at is not None and row.revoked_by_id != row.reviewer_id,
    )


def list_approvals(
    db: Session, *, geo: Event, version_no: int | None, reviewer: str | None
) -> list[EventApproval]:
    """The reviews of ``geo``, by version then oldest first, revoked ones included.

    ``version_no`` keeps one version and ``reviewer`` one analyst's reviews (by username);
    either may be omitted. A soft-deleted reviewer's review is left out, as a soft-deleted
    geolocator is.
    """
    query = (
        db.query(EventApproval)
        .join(User, User.id == EventApproval.reviewer_id)
        .options(joinedload(EventApproval.reviewer))
        .filter(EventApproval.event_id == geo.id, User.deleted_at.is_(None))
    )
    if version_no is not None:
        query = query.filter(EventApproval.version_no == version_no)
    if reviewer is not None:
        query = query.filter(User.username == reviewer)
    return query.order_by(
        EventApproval.version_no, EventApproval.created_at, EventApproval.id
    ).all()


def approve(
    db: Session, *, geo: Event, reviewer: User, version_no: int, note: str | None
) -> EventApproval:
    """Approve the live version of ``geo`` as ``reviewer`` and notify the owner.

    409 ``invalid_state`` off ``geolocated`` (a closed event keeps its approvals readable but
    takes no new one); 403 ``geolocator_cannot_approve`` for a geolocator of the event; 409
    ``version_mismatch`` when ``version_no`` is not the live version; 409 ``already_approved``
    when ``reviewer`` already reviewed that version, revoked or not.
    """
    geo = _lock(db, geo.id)
    # Mirrored by the frontend's lib/approvals.canApprove; change both.
    if geo.status != STATUS_GEOLOCATED:
        raise EventNotApprovableError("Only a published geolocation can be approved")
    if _is_geolocator(db, geo=geo, user_id=reviewer.id):
        raise GeolocatorCannotApproveError("A geolocator of this event cannot approve it")
    if version_no != geo.version_no:
        raise VersionMismatchError(
            f"This event is at version {geo.version_no}; reload it before approving"
        )
    existing = (
        db.query(EventApproval)
        .filter(
            EventApproval.event_id == geo.id,
            EventApproval.version_no == version_no,
            EventApproval.reviewer_id == reviewer.id,
        )
        .first()
    )
    if existing is not None:
        raise AlreadyApprovedError("You already reviewed this version")
    row = EventApproval(event_id=geo.id, version_no=version_no, reviewer_id=reviewer.id, note=note)
    db.add(row)
    notifications.notify_approval_received(db, event=geo, reviewer_id=reviewer.id)
    db.commit()
    db.refresh(row)
    return row


def revoke(
    db: Session, *, geo: Event, approval_id: uuid.UUID, actor: User, reason: str
) -> EventApproval:
    """Revoke one approval of ``geo`` with a public ``reason``.

    The reviewer revokes their own; a site admin revokes any, which writes an ``admin_events``
    row. Anyone else is 403 ``revoke_forbidden``. 404 ``approval_not_found`` for an id that is
    not an approval of ``geo``; 409 ``already_revoked`` for one already revoked.
    """
    geo = _lock(db, geo.id)
    row = (
        db.query(EventApproval)
        .options(joinedload(EventApproval.reviewer))
        .filter(EventApproval.id == approval_id, EventApproval.event_id == geo.id)
        .first()
    )
    if row is None:
        raise ApprovalNotFoundError("No such approval on this event")
    by_reviewer = row.reviewer_id == actor.id
    if not by_reviewer and not actor.is_admin:
        raise RevokeForbiddenError("Only the reviewer or a site admin can revoke this approval")
    if row.revoked_at is not None:
        raise AlreadyRevokedError("This approval is already revoked")
    row.revoked_at = datetime.now(UTC)
    row.revoked_by_id = actor.id
    row.revoke_reason = reason
    if not by_reviewer:
        log_admin_event(
            db,
            actor_id=actor.id,
            action="approval_revoked",
            target={
                "geolocation_id": str(geo.id),
                "approval_id": str(row.id),
                "reviewer_id": str(row.reviewer_id),
                "version_no": row.version_no,
            },
        )
    db.commit()
    db.refresh(row)
    return row
