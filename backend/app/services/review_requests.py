"""Review requests: a geolocator of a published event asks an analyst to review it.

The requester is one of the event's geolocators (its owner or an accepted co-geolocator). The
target must be able to approve the event, so a geolocator of it cannot be asked. The target's
``review_request_audience`` preference decides who may ask them: analysts they follow (the
default), everyone, or nobody. A request is open until the target approves the event, any
version (``approvals.approve`` resolves it), or declines it.

There is one open request per requester, target and event, and a requester sends at most
``settings.review_request_daily_cap`` requests in a trailing 24 hours. Every write locks the event
row first, as approvals do, so a request, its decline and an approval serialize.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, and_, exists, func, or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from app.config import settings
from app.models.approval import EventApproval
from app.models.event import STATUS_GEOLOCATED, Event, EventGeolocator
from app.models.follow import Follow
from app.models.review_request import ReviewRequest
from app.models.user import User
from app.models.user_preferences import (
    REVIEW_REQUEST_AUDIENCE_DEFAULT,
    UserPreferences,
)
from app.schemas.review_request import ReviewRequestRead
from app.schemas.user import AuthorRef
from app.services import notifications
from app.services.approvals import is_geolocator

MAX_TARGET_SUGGESTIONS = 20


class ReviewRequestError(Exception):
    """A review request write the rules refuse, with a stable ``code``."""

    code: str


class EventNotReviewableError(ReviewRequestError):
    code = "invalid_state"


class NotAGeolocatorError(ReviewRequestError):
    code = "not_a_geolocator"


class TargetNotFoundError(ReviewRequestError):
    code = "user_not_found"


class TargetIsGeolocatorError(ReviewRequestError):
    code = "target_is_geolocator"


class RequestsNotAcceptedError(ReviewRequestError):
    code = "requests_not_accepted"


class TargetAlreadyReviewedError(ReviewRequestError):
    code = "already_approved"


class AlreadyRequestedError(ReviewRequestError):
    code = "already_requested"


class DailyCapReachedError(ReviewRequestError):
    code = "daily_cap_reached"


class ReviewRequestNotFoundError(ReviewRequestError):
    code = "review_request_not_found"


class AlreadyResolvedError(ReviewRequestError):
    code = "already_resolved"


REVIEW_REQUEST_ERROR_STATUS: dict[str, int] = {
    "invalid_state": 409,
    "not_a_geolocator": 403,
    "user_not_found": 404,
    "target_is_geolocator": 403,
    "requests_not_accepted": 403,
    "already_approved": 409,
    "already_requested": 409,
    "daily_cap_reached": 429,
    "review_request_not_found": 404,
    "already_resolved": 409,
}

# The refusal states the target's rule and nothing else.
_REFUSAL: dict[str | None, str] = {
    "following": "This analyst accepts review requests only from people they follow",
    "nobody": "This analyst does not accept review requests",
}

_Requester = aliased(User)
_Target = aliased(User)


def _audience() -> ColumnElement[str]:
    """The ``review_request_audience`` of the analyst in scope (``User``), its default when the
    analyst has no preferences row."""
    stored = (
        select(UserPreferences.review_request_audience)
        .where(UserPreferences.user_id == User.id)
        .scalar_subquery()
    )
    return func.coalesce(stored, REVIEW_REQUEST_AUDIENCE_DEFAULT)


def accepts_requests_from(requester_id: uuid.UUID) -> ColumnElement[bool]:
    """The predicate for an analyst (``User``) whose audience admits ``requester_id``."""
    audience = _audience()
    follows_requester = exists().where(
        Follow.follower_id == User.id, Follow.followed_id == requester_id
    )
    return or_(audience == "everyone", and_(audience == "following", follows_requester))


def _lock(db: Session, event_id: uuid.UUID) -> Event:
    return db.query(Event).filter(Event.id == event_id).populate_existing().with_for_update().one()


def _require_requester(db: Session, *, geo: Event, requester: User) -> None:
    # Mirrored by the frontend's lib/reviewRequests.canRequestReview; change both.
    if geo.status != STATUS_GEOLOCATED:
        raise EventNotReviewableError("Only a published geolocation can be reviewed")
    if not is_geolocator(db, geo=geo, user_id=requester.id):
        raise NotAGeolocatorError("Only a geolocator of this event can request a review")


def build_read(row: ReviewRequest) -> ReviewRequestRead:
    return ReviewRequestRead(
        id=row.id,
        event_id=row.event_id,
        version_no=row.version_no,
        requester=AuthorRef.model_validate(row.requester),
        target=AuthorRef.model_validate(row.target_user),
        status=row.status,
        created_at=row.created_at,
        resolved_at=row.resolved_at,
    )


def list_open(db: Session, *, geo: Event, viewer: User) -> list[ReviewRequest]:
    """The open requests on ``geo`` that ``viewer`` may see, oldest first.

    A geolocator sees every one; anyone else sees those addressed to them. A request whose
    requester or target is soft-deleted is left out.
    """
    query = (
        db.query(ReviewRequest)
        .join(_Requester, _Requester.id == ReviewRequest.requester_id)
        .join(_Target, _Target.id == ReviewRequest.target_user_id)
        .options(joinedload(ReviewRequest.requester), joinedload(ReviewRequest.target_user))
        .filter(
            ReviewRequest.event_id == geo.id,
            ReviewRequest.status == "open",
            _Requester.deleted_at.is_(None),
            _Target.deleted_at.is_(None),
        )
    )
    if not is_geolocator(db, geo=geo, user_id=viewer.id):
        query = query.filter(ReviewRequest.target_user_id == viewer.id)
    return query.order_by(ReviewRequest.created_at, ReviewRequest.id).all()


def eligible_targets(db: Session, *, geo: Event, requester: User, query: str) -> list[User]:
    """The analysts ``requester`` can ask to review ``geo`` now, by username.

    Live analysts outside the event's geolocators whose audience admits ``requester``, who have
    not reviewed the live version and hold no open request from ``requester`` on it. ``query``
    narrows by a case-insensitive substring of the username, prefix matches first.
    """
    _require_requester(db, geo=geo, requester=requester)
    stmt = select(User).where(
        User.deleted_at.is_(None),
        User.is_active.is_(True),
        User.id != geo.owner_id,
        User.id.not_in(select(EventGeolocator.user_id).where(EventGeolocator.event_id == geo.id)),
        User.id.not_in(
            select(EventApproval.reviewer_id).where(
                EventApproval.event_id == geo.id, EventApproval.version_no == geo.version_no
            )
        ),
        User.id.not_in(
            select(ReviewRequest.target_user_id).where(
                ReviewRequest.event_id == geo.id,
                ReviewRequest.requester_id == requester.id,
                ReviewRequest.status == "open",
                ReviewRequest.target_user_id.is_not(None),
            )
        ),
        accepts_requests_from(requester.id),
    )
    q = query.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
    if q:
        stmt = stmt.where(User.username.ilike(f"%{q}%", escape="\\")).order_by(
            User.username.ilike(f"{q}%", escape="\\").desc()
        )
    return list(db.scalars(stmt.order_by(User.username).limit(MAX_TARGET_SUGGESTIONS)))


def request_review(db: Session, *, geo: Event, requester: User, username: str) -> ReviewRequest:
    """Ask ``username`` to review the live version of ``geo`` and notify them.

    409 ``invalid_state`` off ``geolocated``; 403 ``not_a_geolocator`` when ``requester`` is
    not credited on the event; 404 ``user_not_found``; 403 ``target_is_geolocator``; 403
    ``requests_not_accepted`` when the target's audience refuses ``requester``; 409
    ``already_approved`` when the target reviewed the live version; 409 ``already_requested``
    for a second open request; 429 ``daily_cap_reached`` past the daily cap.
    """
    geo = _lock(db, geo.id)
    _require_requester(db, geo=geo, requester=requester)
    target = (
        db.query(User)
        .filter(User.username == username, User.deleted_at.is_(None), User.is_active.is_(True))
        .first()
    )
    if target is None:
        raise TargetNotFoundError("No analyst with that username")
    if is_geolocator(db, geo=geo, user_id=target.id):
        raise TargetIsGeolocatorError("A geolocator of this event cannot review it")
    admitted = db.scalar(
        select(accepts_requests_from(requester.id)).select_from(User).where(User.id == target.id)
    )
    if not admitted:
        audience = db.scalar(select(_audience()).select_from(User).where(User.id == target.id))
        raise RequestsNotAcceptedError(_REFUSAL.get(audience, _REFUSAL["nobody"]))
    reviewed = db.scalar(
        select(
            exists().where(
                EventApproval.event_id == geo.id,
                EventApproval.version_no == geo.version_no,
                EventApproval.reviewer_id == target.id,
            )
        )
    )
    if reviewed:
        raise TargetAlreadyReviewedError("This analyst already reviewed the live version")
    pending = db.scalar(
        select(
            exists().where(
                ReviewRequest.event_id == geo.id,
                ReviewRequest.requester_id == requester.id,
                ReviewRequest.target_user_id == target.id,
                ReviewRequest.status == "open",
            )
        )
    )
    if pending:
        raise AlreadyRequestedError("You already asked this analyst to review this event")
    sent_today = db.scalar(
        select(func.count())
        .select_from(ReviewRequest)
        .where(
            ReviewRequest.requester_id == requester.id,
            ReviewRequest.created_at >= datetime.now(UTC) - timedelta(days=1),
        )
    )
    if (sent_today or 0) >= settings.review_request_daily_cap:
        raise DailyCapReachedError(
            f"You can send {settings.review_request_daily_cap} review requests a day"
        )
    row = ReviewRequest(
        event_id=geo.id,
        version_no=geo.version_no,
        requester_id=requester.id,
        target_user_id=target.id,
    )
    db.add(row)
    notifications.notify_review_request_received(
        db, event=geo, requester_id=requester.id, target_id=target.id
    )
    db.commit()
    db.refresh(row)
    return row


def decline(db: Session, *, geo: Event, request_id: uuid.UUID, user: User) -> ReviewRequest:
    """Decline a request addressed to ``user``.

    404 ``review_request_not_found`` for an id that is not a request on ``geo`` addressed to
    ``user``; 409 ``already_resolved`` once it is approved or declined.
    """
    geo = _lock(db, geo.id)
    row = (
        db.query(ReviewRequest)
        .filter(
            ReviewRequest.id == request_id,
            ReviewRequest.event_id == geo.id,
            ReviewRequest.target_user_id == user.id,
        )
        .first()
    )
    if row is None:
        raise ReviewRequestNotFoundError("No such review request for you on this event")
    if row.status != "open":
        raise AlreadyResolvedError("This review request is already resolved")
    row.status = "declined"
    row.resolved_at = datetime.now(UTC)
    notifications.notify_review_request_declined(
        db, event=geo, requester_id=row.requester_id, target_id=user.id
    )
    db.commit()
    db.refresh(row)
    return row
