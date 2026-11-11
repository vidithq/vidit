import asyncio

from fastapi import APIRouter, File, Query, Request, Response, UploadFile, status

from app.dependencies import DB, CurrentUser, Cursor, OptionalUser
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.schemas.approval import OrganizationApprovalRead
from app.schemas.approval_request import OrganizationApprovalRequestRead
from app.schemas.organization import (
    OrganizationInviteCreate,
    OrganizationInviteRead,
    OrganizationMemberRead,
    OrganizationMemberUpdate,
    OrganizationRead,
    OrganizationUpdate,
)
from app.schemas.user import AuthorRef
from app.services import approval_requests as approval_requests_service
from app.services import approvals as approvals_service
from app.services import organizations as organizations_service
from app.services import users as users_service
from app.services.pagination import (
    MAX_PAGE_SIZE,
    decode_cursor,
    encode_cursor,
    page_size,
    paged,
)

router = APIRouter()


@router.get("/{slug}", response_model=OrganizationRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_organization(
    request: Request, slug: str, db: DB, current_user: OptionalUser
) -> OrganizationRead:
    """An organization's public profile, with the caller's role and pending invite."""
    org = organizations_service.get_by_slug(db, slug)
    return organizations_service.build_read(db, org, viewer=current_user)


@router.get("/{slug}/members", response_model=list[OrganizationMemberRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_organization_members(request: Request, slug: str, db: DB) -> list[OrganizationMemberRead]:
    """An organization's members, org managers first, then by join date."""
    org = organizations_service.get_by_slug(db, slug)
    return organizations_service.list_members(db, org)


@router.get("/{slug}/approvals", response_model=list[OrganizationApprovalRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_organization_approvals(
    request: Request,
    response: Response,
    slug: str,
    db: DB,
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: Cursor = None,
) -> list[OrganizationApprovalRead]:
    """The approvals placed in the organization's name, newest first, capped at 100 per page (``Link: rel="next"`` cursor)."""
    org = organizations_service.get_by_slug(db, slug)
    size = page_size(limit)
    window = approvals_service.list_for_organization(
        db,
        org=org,
        limit=size,
        cursor=decode_cursor(cursor),
    )
    rows = paged(request, response, window, size, lambda r: encode_cursor(r.created_at, r.id))
    return [approvals_service.build_organization_read(row) for row in rows]


@router.get("/{slug}/approval-requests", response_model=list[OrganizationApprovalRequestRead])
@limiter.limit("60/minute")
def list_organization_approval_requests(
    request: Request, slug: str, db: DB, current_user: CurrentUser
) -> list[OrganizationApprovalRequestRead]:
    """Open approval requests addressed to the organization, oldest first. Members and site
    admins only."""
    org = organizations_service.get_by_slug(db, slug)
    organizations_service.require_member(db, org, current_user)
    rows = approval_requests_service.list_open_for_organization(db, org=org)
    return [approval_requests_service.build_organization_read(row) for row in rows]


@router.patch("/{slug}", response_model=OrganizationRead)
@limiter.limit("30/minute")
def update_organization(
    request: Request, slug: str, body: OrganizationUpdate, db: DB, current_user: CurrentUser
) -> OrganizationRead:
    """Edit an organization's bio, links and approval request audience. Org managers and site
    admins only."""
    org = organizations_service.get_managed(db, slug, current_user)
    organizations_service.apply_update(org, body)
    db.commit()
    return organizations_service.build_read(db, org, viewer=current_user)


@router.put("/{slug}/avatar", response_model=OrganizationRead)
@limiter.limit("20/minute")
def set_organization_avatar(
    request: Request, slug: str, db: DB, current_user: CurrentUser, file: UploadFile = File(...)
) -> OrganizationRead:
    """Replace an organization's picture, under the rules of ``PUT /users/me/avatar``."""
    org = organizations_service.get_managed(db, slug, current_user)
    org = asyncio.run(users_service.set_avatar(db, owner=org, file=file))
    return organizations_service.build_read(db, org, viewer=current_user)


@router.delete("/{slug}/avatar", response_model=OrganizationRead)
@limiter.limit("20/minute")
def delete_organization_avatar(
    request: Request, slug: str, db: DB, current_user: CurrentUser
) -> OrganizationRead:
    """Drop an organization's picture."""
    org = organizations_service.get_managed(db, slug, current_user)
    org = users_service.clear_avatar(db, owner=org)
    return organizations_service.build_read(db, org, viewer=current_user)


@router.get("/{slug}/invites", response_model=list[OrganizationInviteRead])
@limiter.limit("60/minute")
def list_organization_invites(
    request: Request, slug: str, db: DB, current_user: CurrentUser
) -> list[OrganizationInviteRead]:
    """Pending invites, newest first. Org managers and site admins only."""
    org = organizations_service.get_managed(db, slug, current_user)
    return organizations_service.list_invites(db, org)


@router.get("/{slug}/invite-candidates", response_model=list[AuthorRef])
@limiter.limit("60/minute")
def list_invite_candidates(
    request: Request, slug: str, db: DB, current_user: CurrentUser
) -> list[User]:
    """The analysts you may invite: in mutual follow with you, neither member nor invited."""
    org = organizations_service.get_managed(db, slug, current_user)
    return organizations_service.invite_candidates(db, org, inviter=current_user)


@router.post(
    "/{slug}/invites",
    response_model=OrganizationInviteRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/hour")
def create_organization_invite(
    request: Request, slug: str, body: OrganizationInviteCreate, db: DB, current_user: CurrentUser
) -> OrganizationInviteRead:
    """Invite an analyst in mutual follow with you. Org managers only."""
    org = organizations_service.get_by_slug(db, slug)
    row = organizations_service.invite(db, org, inviter=current_user, username=body.username)
    db.commit()
    return OrganizationInviteRead.model_validate(row)


@router.delete("/{slug}/invites/{username}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def cancel_organization_invite(
    request: Request, slug: str, username: str, db: DB, current_user: CurrentUser
) -> None:
    """Withdraw a pending invite. Org managers and site admins only."""
    org = organizations_service.get_managed(db, slug, current_user)
    organizations_service.cancel_invite(db, org, username=username)
    db.commit()


@router.post("/{slug}/invite/accept", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def accept_organization_invite(
    request: Request, slug: str, db: DB, current_user: CurrentUser
) -> None:
    """Accept your pending invite and join as a member."""
    org = organizations_service.get_by_slug(db, slug)
    organizations_service.accept_invite(db, org, user=current_user)
    db.commit()


@router.post("/{slug}/invite/decline", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def decline_organization_invite(
    request: Request, slug: str, db: DB, current_user: CurrentUser
) -> None:
    """Decline your pending invite."""
    org = organizations_service.get_by_slug(db, slug)
    organizations_service.decline_invite(db, org, user=current_user)
    db.commit()


@router.patch("/{slug}/members/{username}", response_model=OrganizationMemberRead)
@limiter.limit("60/minute")
def update_organization_member(
    request: Request,
    slug: str,
    username: str,
    body: OrganizationMemberUpdate,
    db: DB,
    current_user: CurrentUser,
) -> OrganizationMemberRead:
    """Change a member's role. Org managers and site admins only; the last org manager keeps the role."""
    org = organizations_service.get_managed(db, slug, current_user, lock=True)
    result = organizations_service.change_role(db, org, username=username, role=body.role)
    db.commit()
    return result


@router.delete("/{slug}/members/{username}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def remove_organization_member(
    request: Request, slug: str, username: str, db: DB, current_user: CurrentUser
) -> None:
    """Remove a member, or leave with your own username. The last org manager cannot leave."""
    org = organizations_service.get_by_slug(db, slug, lock=True)
    organizations_service.remove_member(db, org, actor=current_user, username=username)
    db.commit()
