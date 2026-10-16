"""Review requests: a geolocator of a published event asks an analyst or an organization to
review it.

The requester is one of the event's geolocators (its owner or an accepted co-geolocator). The
target must be able to approve the event, so a geolocator of it cannot be asked, and an
organization needs a live org-admin outside the event's geolocators. The target's
``review_request_audience`` decides who may ask: analysts they follow (the default), everyone,
or nobody. An organization's org-admins set its audience, and ``following`` there admits an
analyst whom any live org-admin follows. A request is open until the target approves the event,
any version (``approvals.approve`` resolves it), or declines it. Any org-admin answers for an
organization.

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
from app.models.organization import Organization, OrganizationMember
from app.models.review_request import ReviewRequest
from app.models.user import User
from app.models.user_preferences import (
    REVIEW_REQUEST_AUDIENCE_DEFAULT,
    UserPreferences,
)
from app.schemas.notification import NotificationEventRef
from app.schemas.organization import OrganizationRef
from app.schemas.review_request import (
    OrganizationReviewRequestRead,
    ReviewRequestRead,
    ReviewRequestTargetList,
)
from app.schemas.user import AuthorRef
from app.services import notifications
from app.services.approvals import is_geolocator
from app.services.event_filters import visible_events
from app.services.organizations import is_organization_admin, live_admin_ids

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


class OrganizationNotFoundError(ReviewRequestError):
    code = "organization_not_found"


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
    "organization_not_found": 404,
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
_ORGANIZATION_REFUSAL: dict[str | None, str] = {
    "following": "This organization accepts review requests only from people its org-admins follow",
    "nobody": "This organization does not accept review requests",
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


def organization_accepts_requests_from(requester_id: uuid.UUID) -> ColumnElement[bool]:
    """The predicate for an organization (``Organization``) whose audience admits
    ``requester_id``: ``following`` admits an analyst whom any live org-admin follows."""
    audience = Organization.review_request_audience
    followed_by_an_admin = exists().where(
        Follow.follower_id.in_(live_admin_ids(Organization.id)),
        Follow.followed_id == requester_id,
    )
    return or_(audience == "everyone", and_(audience == "following", followed_by_an_admin))


def _can_act_for(geo: Event) -> ColumnElement[bool]:
    """The predicate for an organization (``Organization``) with a live org-admin outside the
    geolocators of ``geo``, who can approve it in the organization's name."""
    return (
        live_admin_ids(Organization.id)
        .where(
            OrganizationMember.user_id != geo.owner_id,
            OrganizationMember.user_id.not_in(
                select(EventGeolocator.user_id).where(EventGeolocator.event_id == geo.id)
            ),
        )
        .exists()
    )


def _administered_by(user_id: uuid.UUID):
    return select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == user_id, OrganizationMember.role == "admin"
    )


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
        target=AuthorRef.model_validate(row.target_user) if row.target_user else None,
        target_organization=(
            OrganizationRef.model_validate(row.target_organization)
            if row.target_organization
            else None
        ),
        status=row.status,
        created_at=row.created_at,
        resolved_at=row.resolved_at,
    )


def _open_query(db: Session):
    """Open requests whose requester and analyst target are live."""
    return (
        db.query(ReviewRequest)
        .join(_Requester, _Requester.id == ReviewRequest.requester_id)
        .outerjoin(_Target, _Target.id == ReviewRequest.target_user_id)
        .options(
            joinedload(ReviewRequest.requester),
            joinedload(ReviewRequest.target_user),
            joinedload(ReviewRequest.target_organization),
        )
        .filter(
            ReviewRequest.status == "open",
            _Requester.deleted_at.is_(None),
            or_(ReviewRequest.target_user_id.is_(None), _Target.deleted_at.is_(None)),
        )
    )


def list_open(db: Session, *, geo: Event, viewer: User) -> list[ReviewRequest]:
    """The open requests on ``geo`` that ``viewer`` may see, oldest first.

    A geolocator sees every one; anyone else sees those addressed to them or to an organization
    they are an org-admin of. A request whose requester or analyst target is soft-deleted is
    left out.
    """
    query = _open_query(db).filter(ReviewRequest.event_id == geo.id)
    if not is_geolocator(db, geo=geo, user_id=viewer.id):
        query = query.filter(
            or_(
                ReviewRequest.target_user_id == viewer.id,
                ReviewRequest.target_organization_id.in_(_administered_by(viewer.id)),
            )
        )
    return query.order_by(ReviewRequest.created_at, ReviewRequest.id).all()


def list_open_for_organization(db: Session, *, org: Organization) -> list[ReviewRequest]:
    """The open requests addressed to ``org`` on events a public reader can see, oldest first."""
    return (
        _open_query(db)
        .join(Event, and_(Event.id == ReviewRequest.event_id, *visible_events()))
        .options(joinedload(ReviewRequest.event))
        .filter(ReviewRequest.target_organization_id == org.id)
        .order_by(ReviewRequest.created_at, ReviewRequest.id)
        .all()
    )


def build_organization_read(row: ReviewRequest) -> OrganizationReviewRequestRead:
    return OrganizationReviewRequestRead(
        event=NotificationEventRef.model_validate(row.event), request=build_read(row)
    )


def _substring(query: str) -> str:
    return query.strip().replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


def _eligible_analysts(db: Session, *, geo: Event, requester: User, q: str) -> list[User]:
    stmt = select(User).where(
        User.deleted_at.is_(None),
        User.is_active.is_(True),
        User.id != geo.owner_id,
        User.id.not_in(select(EventGeolocator.user_id).where(EventGeolocator.event_id == geo.id)),
        User.id.not_in(
            select(EventApproval.reviewer_id).where(
                EventApproval.event_id == geo.id,
                EventApproval.version_no == geo.version_no,
                EventApproval.organization_id.is_(None),
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
    if q:
        stmt = stmt.where(User.username.ilike(f"%{q}%", escape="\\")).order_by(
            User.username.ilike(f"{q}%", escape="\\").desc()
        )
    return list(db.scalars(stmt.order_by(User.username).limit(MAX_TARGET_SUGGESTIONS)))


def _eligible_organizations(
    db: Session, *, geo: Event, requester: User, q: str
) -> list[Organization]:
    stmt = select(Organization).where(
        _can_act_for(geo),
        Organization.id.not_in(
            select(EventApproval.organization_id).where(
                EventApproval.event_id == geo.id,
                EventApproval.version_no == geo.version_no,
                EventApproval.organization_id.is_not(None),
                EventApproval.revoked_at.is_(None),
            )
        ),
        Organization.id.not_in(
            select(ReviewRequest.target_organization_id).where(
                ReviewRequest.event_id == geo.id,
                ReviewRequest.requester_id == requester.id,
                ReviewRequest.status == "open",
                ReviewRequest.target_organization_id.is_not(None),
            )
        ),
        organization_accepts_requests_from(requester.id),
    )
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(
            or_(
                Organization.name.ilike(pattern, escape="\\"),
                Organization.slug.ilike(pattern, escape="\\"),
            )
        )
    return list(db.scalars(stmt.order_by(Organization.name).limit(MAX_TARGET_SUGGESTIONS)))


def eligible_targets(
    db: Session, *, geo: Event, requester: User, query: str
) -> ReviewRequestTargetList:
    """The analysts and organizations ``requester`` can ask to review ``geo`` now.

    Analysts: live, outside the event's geolocators, whose audience admits ``requester``, who
    have not reviewed the live version and hold no open request from ``requester`` on it.
    ``query`` narrows by a case-insensitive substring of the username, prefix matches first.
    Organizations: with a live org-admin outside the geolocators, whose audience admits
    ``requester``, without a standing approval of the live version or an open request from
    ``requester``, by name; ``query`` narrows by a substring of the name or the slug.
    """
    _require_requester(db, geo=geo, requester=requester)
    q = _substring(query)
    return ReviewRequestTargetList(
        analysts=[
            AuthorRef.model_validate(u)
            for u in _eligible_analysts(db, geo=geo, requester=requester, q=q)
        ],
        organizations=[
            OrganizationRef.model_validate(o)
            for o in _eligible_organizations(db, geo=geo, requester=requester, q=q)
        ],
    )


def _check_daily_cap(db: Session, *, requester: User) -> None:
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


def _check_analyst_target(db: Session, *, geo: Event, requester: User, username: str) -> User:
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
                EventApproval.organization_id.is_(None),
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
    return target


def _check_organization_target(
    db: Session, *, geo: Event, requester: User, slug: str
) -> Organization:
    org = db.query(Organization).filter(Organization.slug == slug).first()
    if org is None:
        raise OrganizationNotFoundError("No organization with that slug")
    if not db.scalar(
        select(_can_act_for(geo)).select_from(Organization).where(Organization.id == org.id)
    ):
        raise TargetIsGeolocatorError(
            "No org-admin of this organization outside the geolocators of this event can review it"
        )
    admitted = db.scalar(
        select(organization_accepts_requests_from(requester.id))
        .select_from(Organization)
        .where(Organization.id == org.id)
    )
    if not admitted:
        raise RequestsNotAcceptedError(
            _ORGANIZATION_REFUSAL.get(org.review_request_audience, _ORGANIZATION_REFUSAL["nobody"])
        )
    approved = db.scalar(
        select(
            exists().where(
                EventApproval.event_id == geo.id,
                EventApproval.version_no == geo.version_no,
                EventApproval.organization_id == org.id,
                EventApproval.revoked_at.is_(None),
            )
        )
    )
    if approved:
        raise TargetAlreadyReviewedError("This organization already approved the live version")
    pending = db.scalar(
        select(
            exists().where(
                ReviewRequest.event_id == geo.id,
                ReviewRequest.requester_id == requester.id,
                ReviewRequest.target_organization_id == org.id,
                ReviewRequest.status == "open",
            )
        )
    )
    if pending:
        raise AlreadyRequestedError("You already asked this organization to review this event")
    return org


def request_review(
    db: Session,
    *,
    geo: Event,
    requester: User,
    username: str | None = None,
    organization: str | None = None,
) -> ReviewRequest:
    """Ask the analyst ``username``, or the organization with slug ``organization``, to review
    the live version of ``geo``, and notify the analyst or every live org-admin.

    409 ``invalid_state`` off ``geolocated``; 403 ``not_a_geolocator`` when ``requester`` is
    not credited on the event; 404 ``user_not_found`` or ``organization_not_found``; 403
    ``target_is_geolocator`` for a geolocator target, or an organization whose every live
    org-admin is a geolocator; 403 ``requests_not_accepted`` when the target's audience refuses
    ``requester``; 409 ``already_approved`` when the target approved the live version; 409
    ``already_requested`` for a second open request; 429 ``daily_cap_reached`` past the daily
    cap.
    """
    geo = _lock(db, geo.id)
    _require_requester(db, geo=geo, requester=requester)
    if organization is not None:
        org = _check_organization_target(db, geo=geo, requester=requester, slug=organization)
        _check_daily_cap(db, requester=requester)
        row = ReviewRequest(
            event_id=geo.id,
            version_no=geo.version_no,
            requester_id=requester.id,
            target_organization_id=org.id,
        )
        recipient_ids = list(db.scalars(live_admin_ids(org.id)))
        organization_id: uuid.UUID | None = org.id
    else:
        assert username is not None
        target = _check_analyst_target(db, geo=geo, requester=requester, username=username)
        _check_daily_cap(db, requester=requester)
        row = ReviewRequest(
            event_id=geo.id,
            version_no=geo.version_no,
            requester_id=requester.id,
            target_user_id=target.id,
        )
        recipient_ids = [target.id]
        organization_id = None
    db.add(row)
    notifications.notify_review_request_received(
        db,
        event=geo,
        requester_id=requester.id,
        recipient_ids=recipient_ids,
        organization_id=organization_id,
    )
    db.commit()
    db.refresh(row)
    return row


def decline(db: Session, *, geo: Event, request_id: uuid.UUID, user: User) -> ReviewRequest:
    """Decline a request addressed to ``user``, or to an organization ``user`` is an org-admin
    of, and tell the requester.

    404 ``review_request_not_found`` for an id that is not such a request on ``geo``; 409
    ``already_resolved`` once it is approved or declined.
    """
    geo = _lock(db, geo.id)
    row = (
        db.query(ReviewRequest)
        .filter(ReviewRequest.id == request_id, ReviewRequest.event_id == geo.id)
        .first()
    )
    answerable = row is not None and (
        row.target_user_id == user.id
        or (
            row.target_organization_id is not None
            and is_organization_admin(db, org_id=row.target_organization_id, user_id=user.id)
        )
    )
    if row is None or not answerable:
        raise ReviewRequestNotFoundError("No such review request for you on this event")
    if row.status != "open":
        raise AlreadyResolvedError("This review request is already resolved")
    row.status = "declined"
    row.resolved_at = datetime.now(UTC)
    notifications.notify_review_request_declined(
        db,
        event=geo,
        requester_id=row.requester_id,
        target_id=user.id,
        organization_id=row.target_organization_id,
    )
    db.commit()
    db.refresh(row)
    return row
