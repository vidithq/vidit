"""Organizations: the site admin's create, the public reads, and membership.

Entry is by invitation only. An org-admin invites an analyst in mutual follow
with them, and the invitee accepts or declines. Every write that can remove an
org-admin (a demotion, a removal, a leave) locks the organization row first,
so two concurrent writes cannot both pass the last-admin check.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ColumnExpressionArgument, Select, case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.organization import (
    Organization,
    OrganizationInvite,
    OrganizationMember,
    OrganizationRole,
)
from app.models.user import User
from app.schemas.organization import (
    AdminOrganizationRead,
    OrganizationCreate,
    OrganizationInviteRead,
    OrganizationMemberRead,
    OrganizationMembershipRead,
    OrganizationRead,
    OrganizationRef,
    OrganizationUpdate,
)
from app.schemas.user import AuthorRef
from app.services import admin as admin_service
from app.services import notifications, social
from app.services.users import apply_profile_update


class OrganizationError(Exception):
    """A refused organization action. Carries a stable ``code`` for the router."""

    code: str = "organization_error"


class OrganizationNotFoundError(OrganizationError):
    code = "organization_not_found"


class UserNotFoundError(OrganizationError):
    code = "user_not_found"


class SlugTakenError(OrganizationError):
    code = "slug_taken"


class XHandleConflictError(OrganizationError):
    code = "x_handle_conflict"


class NotOrganizationAdminError(OrganizationError):
    code = "not_organization_admin"


class NotMutualFollowError(OrganizationError):
    code = "not_mutual_follow"


class AlreadyMemberError(OrganizationError):
    code = "already_member"


class AlreadyInvitedError(OrganizationError):
    code = "already_invited"


class InviteNotFoundError(OrganizationError):
    code = "invite_not_found"


class MemberNotFoundError(OrganizationError):
    code = "member_not_found"


class LastAdminError(OrganizationError):
    """The action would leave the organization without a live org-admin."""

    code = "last_admin"


ORGANIZATION_ERROR_STATUS: dict[str, int] = {
    "organization_not_found": 404,
    "user_not_found": 404,
    "invite_not_found": 404,
    "member_not_found": 404,
    "not_organization_admin": 403,
    "not_mutual_follow": 403,
    "slug_taken": 409,
    "x_handle_conflict": 409,
    "already_member": 409,
    "already_invited": 409,
    "last_admin": 409,
}


def get_by_slug(db: Session, slug: str, *, lock: bool = False) -> Organization:
    query = db.query(Organization).filter(Organization.slug == slug)
    if lock:
        query = query.with_for_update()
    org = query.first()
    if org is None:
        raise OrganizationNotFoundError("Organization not found")
    return org


def _live_user(db: Session, username: str) -> User:
    user = db.query(User).filter(User.username == username, User.deleted_at.is_(None)).first()
    if user is None:
        raise UserNotFoundError("User not found")
    return user


def _membership(db: Session, org_id: uuid.UUID, user_id: uuid.UUID) -> OrganizationMember | None:
    return (
        db.query(OrganizationMember)
        .filter(OrganizationMember.organization_id == org_id, OrganizationMember.user_id == user_id)
        .first()
    )


def is_organization_admin(db: Session, *, org_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """The one role predicate: whether ``user_id`` may act in the organization's name."""
    member = _membership(db, org_id, user_id)
    return member is not None and member.role == "admin"


def live_admin_ids(
    org_id: uuid.UUID | ColumnExpressionArgument[uuid.UUID],
) -> Select[tuple[uuid.UUID]]:
    """The live org-admins of ``org_id``, the analysts who act in its name. ``org_id`` may be a
    column, to correlate with an outer query."""
    return (
        select(OrganizationMember.user_id)
        .join(User, User.id == OrganizationMember.user_id)
        .where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.role == "admin",
            User.deleted_at.is_(None),
        )
    )


def _can_manage(db: Session, org: Organization, user: User) -> bool:
    """Org-admins manage their organization; a site admin manages any."""
    return user.is_admin or is_organization_admin(db, org_id=org.id, user_id=user.id)


def require_manager(db: Session, org: Organization, user: User) -> None:
    if not _can_manage(db, org, user):
        raise NotOrganizationAdminError("Only an org-admin can do this")


def _live_admin_count(db: Session, org_id: uuid.UUID) -> int:
    return _live_members(db, org_id).filter(OrganizationMember.role == "admin").count()


def _live_members(db: Session, org_id: uuid.UUID):
    return (
        db.query(OrganizationMember)
        .join(User, User.id == OrganizationMember.user_id)
        .filter(OrganizationMember.organization_id == org_id, User.deleted_at.is_(None))
    )


def hand_over_admin_roles(db: Session, *, leaving_user_id: uuid.UUID) -> None:
    """Keep each organization ``leaving_user_id`` administers with a live org-admin.

    Runs in the transaction that erases or soft-deletes the account. Where they
    are the last live org-admin, the earliest-joined live member becomes
    org-admin and is notified. An organization with no other live member keeps
    no admin, and ``GET /admin/organizations`` flags it.
    """
    org_ids = [
        org_id
        for (org_id,) in db.query(OrganizationMember.organization_id).filter(
            OrganizationMember.user_id == leaving_user_id, OrganizationMember.role == "admin"
        )
    ]
    for org_id in sorted(org_ids):
        db.query(Organization.id).filter(Organization.id == org_id).with_for_update().one()
        others = _live_members(db, org_id).filter(OrganizationMember.user_id != leaving_user_id)
        if others.filter(OrganizationMember.role == "admin").first() is not None:
            continue
        heir = others.order_by(OrganizationMember.joined_at, OrganizationMember.user_id).first()
        if heir is None:
            continue
        heir.role = "admin"
        notifications.notify_organization_admin_inherited(
            db, organization_id=org_id, heir_id=heir.user_id
        )


def list_for_admin(db: Session) -> list[AdminOrganizationRead]:
    """Every organization with its live member and org-admin counts, those
    without an org-admin first."""
    live = (
        db.query(
            OrganizationMember.organization_id.label("org_id"),
            func.count().label("members"),
            func.count().filter(OrganizationMember.role == "admin").label("admins"),
        )
        .join(User, User.id == OrganizationMember.user_id)
        .filter(User.deleted_at.is_(None))
        .group_by(OrganizationMember.organization_id)
        .subquery()
    )
    admins = func.coalesce(live.c.admins, 0)
    rows = (
        db.query(Organization, func.coalesce(live.c.members, 0), admins)
        .outerjoin(live, live.c.org_id == Organization.id)
        .order_by(case((admins == 0, 0), else_=1), Organization.name)
        .all()
    )
    return [
        AdminOrganizationRead(
            slug=org.slug,
            name=org.name,
            member_count=members,
            admin_count=admin_count,
            created_at=org.created_at,
        )
        for org, members, admin_count in rows
    ]


def create_organization(db: Session, *, actor: User, body: OrganizationCreate) -> Organization:
    """Create an organization with ``body.admin_username`` as its first org-admin, with audit."""
    first_admin = _live_user(db, body.admin_username)
    if db.query(Organization.id).filter(Organization.slug == body.slug).first() is not None:
        raise SlugTakenError("An organization already uses this slug")
    if (
        body.x_handle is not None
        and db.query(Organization.id).filter(Organization.x_handle == body.x_handle).first()
        is not None
    ):
        raise XHandleConflictError("X handle already linked to another organization")
    # Analysts and organizations share one X handle namespace.
    if (
        body.x_handle is not None
        and db.query(User.id).filter(User.x_handle == body.x_handle).first() is not None
    ):
        raise XHandleConflictError("X handle already linked to an analyst")

    org = Organization(
        slug=body.slug, name=body.name, x_handle=body.x_handle, created_by_id=actor.id
    )
    apply_update(org, body)
    db.add(org)
    db.flush()
    db.add(OrganizationMember(organization_id=org.id, user_id=first_admin.id, role="admin"))
    admin_service.log_admin_event(
        db,
        actor_id=actor.id,
        action="organization_created",
        target={
            "organization_id": str(org.id),
            "slug": org.slug,
            "admin_user_id": str(first_admin.id),
        },
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # A concurrent create took the slug or the handle between the checks and the commit.
        db.rollback()
        raise SlugTakenError("An organization already uses this slug or X handle") from exc
    db.refresh(org)
    return org


def appoint_admin(
    db: Session, *, actor: User, org: Organization, username: str
) -> OrganizationMemberRead:
    """Make the live analyst ``username`` an org-admin of ``org``, with audit: a site admin's
    way back into an organization left without one. A member is promoted; anyone else joins as
    an org-admin without an invite, as the first org-admin does at creation. ``org`` must be
    locked by the caller. 404 ``user_not_found`` for an unknown or soft-deleted analyst."""
    user = _live_user(db, username)
    member = _membership(db, org.id, user.id)
    if member is None:
        member = OrganizationMember(organization_id=org.id, user_id=user.id, role="admin")
        db.add(member)
        db.query(OrganizationInvite).filter(
            OrganizationInvite.organization_id == org.id, OrganizationInvite.user_id == user.id
        ).delete(synchronize_session=False)
    else:
        member.role = "admin"
    db.flush()
    admin_service.log_admin_event(
        db,
        actor_id=actor.id,
        action="organization_admin_appointed",
        target={"organization_id": str(org.id), "slug": org.slug, "user_id": str(user.id)},
    )
    db.commit()
    db.refresh(member)
    return OrganizationMemberRead(
        user=AuthorRef.model_validate(user), role=member.role, joined_at=member.joined_at
    )


def apply_update(org: Organization, body: OrganizationUpdate) -> None:
    """Apply the profile fields and the review request audience ``body`` sets."""
    apply_profile_update(org, body)
    if body.review_request_audience is not None:
        org.review_request_audience = body.review_request_audience


def build_read(db: Session, org: Organization, *, viewer: User | None) -> OrganizationRead:
    role: OrganizationRole | None = None
    invited = False
    can_manage = False
    if viewer is not None:
        member = _membership(db, org.id, viewer.id)
        role = member.role if member is not None else None
        invited = (
            db.query(OrganizationInvite.id)
            .filter(
                OrganizationInvite.organization_id == org.id,
                OrganizationInvite.user_id == viewer.id,
            )
            .first()
            is not None
        )
        can_manage = viewer.is_admin or role == "admin"
    return OrganizationRead(
        id=org.id,
        slug=org.slug,
        name=org.name,
        x_handle=org.x_handle,
        bio=org.bio,
        avatar_url=org.avatar_url,
        external_links=org.external_links or {},
        created_at=org.created_at,
        member_count=_live_members(db, org.id).count(),
        review_request_audience=org.review_request_audience,
        viewer_role=role,
        viewer_invited=invited,
        viewer_can_manage=can_manage,
    )


def list_members(db: Session, org: Organization) -> list[OrganizationMemberRead]:
    """Live members, org-admins first, then by join date."""
    rows = (
        _live_members(db, org.id)
        .options(joinedload(OrganizationMember.user))
        .order_by(
            case((OrganizationMember.role == "admin", 0), else_=1),
            OrganizationMember.joined_at,
            User.username,
        )
        .all()
    )
    return [
        OrganizationMemberRead(
            user=AuthorRef.model_validate(row.user), role=row.role, joined_at=row.joined_at
        )
        for row in rows
    ]


def list_memberships(db: Session, user: User) -> list[OrganizationMembershipRead]:
    """The organizations ``user`` belongs to, by name."""
    rows = (
        db.query(OrganizationMember)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .options(joinedload(OrganizationMember.organization))
        .filter(OrganizationMember.user_id == user.id)
        .order_by(Organization.name)
        .all()
    )
    return [
        OrganizationMembershipRead(
            organization=OrganizationRef.model_validate(row.organization),
            role=row.role,
            joined_at=row.joined_at,
        )
        for row in rows
    ]


def invite_candidates(db: Session, org: Organization, *, inviter: User) -> list[User]:
    """Analysts ``inviter`` may invite: in mutual follow, live, neither member nor invited."""
    members = db.query(OrganizationMember.user_id).filter(
        OrganizationMember.organization_id == org.id
    )
    invited = db.query(OrganizationInvite.user_id).filter(
        OrganizationInvite.organization_id == org.id
    )
    return (
        db.query(User)
        .filter(
            User.id.in_(social.mutual_follow_ids(inviter.id)),
            User.deleted_at.is_(None),
            User.id.not_in(members),
            User.id.not_in(invited),
        )
        .order_by(User.username)
        .all()
    )


def invite(db: Session, org: Organization, *, inviter: User, username: str) -> OrganizationInvite:
    """Invite ``username`` and notify them. Only an org-admin invites, and only
    an analyst in mutual follow with them."""
    if not is_organization_admin(db, org_id=org.id, user_id=inviter.id):
        raise NotOrganizationAdminError("Only an org-admin can invite")
    invitee = _live_user(db, username)
    if _membership(db, org.id, invitee.id) is not None:
        raise AlreadyMemberError("Already a member")
    if not social.is_mutual_follow(db, a_id=inviter.id, b_id=invitee.id):
        raise NotMutualFollowError("You can invite only an analyst you follow who follows you back")
    row = OrganizationInvite(organization_id=org.id, user_id=invitee.id, invited_by_id=inviter.id)
    try:
        with db.begin_nested():
            db.add(row)
    except IntegrityError as exc:
        raise AlreadyInvitedError("Already invited") from exc
    notifications.notify_organization_invite(db, invite=row)
    return row


def list_invites(db: Session, org: Organization) -> list[OrganizationInviteRead]:
    rows = (
        db.query(OrganizationInvite)
        .join(User, User.id == OrganizationInvite.user_id)
        .options(joinedload(OrganizationInvite.user), joinedload(OrganizationInvite.invited_by))
        .filter(OrganizationInvite.organization_id == org.id, User.deleted_at.is_(None))
        .order_by(OrganizationInvite.created_at.desc())
        .all()
    )
    return [build_invite_read(row) for row in rows]


def build_invite_read(row: OrganizationInvite) -> OrganizationInviteRead:
    return OrganizationInviteRead(
        id=row.id,
        user=AuthorRef.model_validate(row.user),
        invited_by=AuthorRef.model_validate(row.invited_by) if row.invited_by else None,
        created_at=row.created_at,
    )


def cancel_invite(db: Session, org: Organization, *, invite_id: uuid.UUID) -> None:
    deleted = (
        db.query(OrganizationInvite)
        .filter(OrganizationInvite.id == invite_id, OrganizationInvite.organization_id == org.id)
        .delete(synchronize_session=False)
    )
    if not deleted:
        raise InviteNotFoundError("Invite not found")


def _take_invite(db: Session, org: Organization, user: User) -> OrganizationInvite:
    row = (
        db.query(OrganizationInvite)
        .filter(OrganizationInvite.organization_id == org.id, OrganizationInvite.user_id == user.id)
        .with_for_update()
        .first()
    )
    if row is None:
        raise InviteNotFoundError("No pending invite")
    db.delete(row)
    return row


def accept_invite(db: Session, org: Organization, *, user: User) -> None:
    """Join as a member and tell the inviter. The invite row goes."""
    row = _take_invite(db, org, user)
    if _membership(db, org.id, user.id) is None:
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
    notifications.notify_organization_invite_accepted(db, invite=row, member_id=user.id)


def decline_invite(db: Session, org: Organization, *, user: User) -> None:
    """Drop the invite. Nobody is notified."""
    _take_invite(db, org, user)


def _member_or_404(db: Session, org: Organization, username: str) -> OrganizationMember:
    target = _live_user(db, username)
    member = _membership(db, org.id, target.id)
    if member is None:
        raise MemberNotFoundError("Not a member")
    return member


def _guard_last_admin(db: Session, org: Organization, member: OrganizationMember) -> None:
    if member.role == "admin" and _live_admin_count(db, org.id) <= 1:
        raise LastAdminError("The last org-admin cannot leave or be demoted")


def change_role(
    db: Session, org: Organization, *, username: str, role: OrganizationRole
) -> OrganizationMemberRead:
    """Set a member's role. ``org`` must be locked by the caller."""
    member = _member_or_404(db, org, username)
    if role == "member":
        _guard_last_admin(db, org, member)
    member.role = role
    return OrganizationMemberRead(
        user=AuthorRef.model_validate(member.user), role=member.role, joined_at=member.joined_at
    )


def remove_member(db: Session, org: Organization, *, actor: User, username: str) -> None:
    """Remove a member, or leave when ``username`` is the actor. ``org`` must be
    locked by the caller."""
    member = _member_or_404(db, org, username)
    if member.user_id != actor.id:
        require_manager(db, org, actor)
    _guard_last_admin(db, org, member)
    db.delete(member)
