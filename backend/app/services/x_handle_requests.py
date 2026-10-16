"""Analyst requests to change the X handle bound to their account.

The analyst files a request; an admin approves it through
``admin.set_user_x_handle``, the only write path for ``users.x_handle``, or
declines it with a reason. Either outcome notifies the analyst.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session, contains_eager

from app.models.user import User
from app.models.x_handle_request import XHandleRequest
from app.schemas.x_handle_request import XHandleRead, XHandleRequestRead
from app.services import admin as admin_service
from app.services import notifications


class XHandleUnchangedError(Exception):
    code = "x_handle_unchanged"


SELF_ERROR_STATUS: dict[str, int] = {XHandleUnchangedError.code: 409}


class XHandleRequestNotFoundError(admin_service.AdminError):
    """No pending request carries that id: unknown, replaced, or decided."""

    code = "x_handle_request_not_found"


def _own_request(db: Session, user: User) -> XHandleRequest | None:
    return db.query(XHandleRequest).filter(XHandleRequest.user_id == user.id).one_or_none()


def read_own(db: Session, *, user: User) -> XHandleRead:
    row = _own_request(db, user)
    return XHandleRead(
        x_handle=user.x_handle,
        request=XHandleRequestRead.model_validate(row) if row is not None else None,
    )


def submit(db: Session, *, user: User, x_handle: str, reason: str | None) -> XHandleRead:
    """File ``user``'s request, replacing any earlier one, pending or declined.

    No availability check here: whether another account holds the handle is
    the admin's conflict check to answer, and answering it to the requester
    would reveal who holds which handle.
    """
    if x_handle == user.x_handle:
        raise XHandleUnchangedError("This X handle is already linked to your account")
    # The account row lock serializes two submissions, which would otherwise
    # both pass the delete and collide on the UNIQUE ``user_id``.
    db.query(User.id).filter(User.id == user.id).with_for_update().one()
    db.query(XHandleRequest).filter(XHandleRequest.user_id == user.id).delete(
        synchronize_session=False
    )
    db.add(XHandleRequest(user_id=user.id, x_handle=x_handle, reason=reason))
    db.commit()
    return read_own(db, user=user)


def list_pending(db: Session) -> list[XHandleRequest]:
    """Every pending request on a live account, oldest first."""
    return (
        db.query(XHandleRequest)
        .join(XHandleRequest.user)
        .options(contains_eager(XHandleRequest.user))
        .filter(XHandleRequest.status == "pending", User.deleted_at.is_(None))
        .order_by(XHandleRequest.created_at.asc(), XHandleRequest.id.asc())
        .all()
    )


def _pending_for_update(db: Session, request_id: uuid.UUID) -> XHandleRequest:
    row = (
        db.query(XHandleRequest)
        .filter(XHandleRequest.id == request_id, XHandleRequest.status == "pending")
        .with_for_update()
        .one_or_none()
    )
    if row is None:
        raise XHandleRequestNotFoundError("No pending X handle request with that id")
    return row


def approve(db: Session, *, actor_id: uuid.UUID, request_id: uuid.UUID) -> User:
    """Bind the requested handle and drop the request, in one transaction.

    ``set_user_x_handle`` runs its conflict check and commits the deletion and
    the notification with the link. A conflict rolls all three back and
    leaves the request pending.
    """
    row = _pending_for_update(db, request_id)
    user_id, x_handle = row.user_id, row.x_handle
    db.delete(row)
    notifications.notify_x_handle_request_outcome(db, recipient_id=user_id, approved=True)
    try:
        return admin_service.set_user_x_handle(
            db, actor_id=actor_id, user_id=user_id, x_handle=x_handle
        )
    except admin_service.AdminError:
        db.rollback()
        raise


def decline(db: Session, *, actor_id: uuid.UUID, request_id: uuid.UUID, reason: str) -> None:
    row = _pending_for_update(db, request_id)
    row.status = "declined"
    row.decline_reason = reason
    row.decided_at = datetime.now(UTC)
    notifications.notify_x_handle_request_outcome(db, recipient_id=row.user_id, approved=False)
    admin_service.log_admin_event(
        db,
        actor_id=actor_id,
        action="x_handle_request_declined",
        target={"user_id": str(row.user_id), "x_handle": row.x_handle, "reason": reason},
    )
    db.commit()
