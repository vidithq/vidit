import asyncio
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_current_user_optional, get_db
from app.models.user import User
from app.ratelimit import authenticated_read_quota, limiter
from app.routers._errors import raise_typed_error
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
    next_link,
    page_size,
    take_page,
)

router = APIRouter()


@contextmanager
def _typed_errors() -> Iterator[None]:
    try:
        yield
    except organizations_service.OrganizationError as exc:
        raise_typed_error(exc, organizations_service.ORGANIZATION_ERROR_STATUS)
    except users_service.AvatarError as exc:
        raise_typed_error(exc, users_service.AVATAR_ERROR_STATUS)


@router.get("/{slug}", response_model=OrganizationRead)
@authenticated_read_quota
@limiter.limit("120/minute")
def get_organization(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> OrganizationRead:
    """An organization's public profile, with the caller's role and pending invite."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
    return organizations_service.build_read(db, org, viewer=current_user)


@router.get("/{slug}/members", response_model=list[OrganizationMemberRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_organization_members(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
) -> list[OrganizationMemberRead]:
    """An organization's members, org managers first, then by join date."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
    return organizations_service.list_members(db, org)


@router.get("/{slug}/approvals", response_model=list[OrganizationApprovalRead])
@authenticated_read_quota
@limiter.limit("120/minute")
def list_organization_approvals(
    request: Request,
    response: Response,
    slug: str,
    limit: int = Query(MAX_PAGE_SIZE, ge=1),
    cursor: str | None = Query(None, description="Opaque cursor from a Link: rel=next header"),
    db: Session = Depends(get_db),
) -> list[OrganizationApprovalRead]:
    """The approvals placed in the organization's name, newest first, revoked ones included,
    capped at 100 per page (``Link: rel="next"`` cursor)."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
    size = page_size(limit)
    window = approvals_service.list_for_organization(
        db,
        org=org,
        limit=size,
        cursor=decode_cursor(cursor) if cursor is not None else None,
    )
    rows, has_next = take_page(window, size)
    if has_next:
        last = rows[-1]
        response.headers["Link"] = next_link(request, encode_cursor(last.created_at, last.id))
    return [approvals_service.build_organization_read(row) for row in rows]


@router.get("/{slug}/approval-requests", response_model=list[OrganizationApprovalRequestRead])
@limiter.limit("60/minute")
def list_organization_approval_requests(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[OrganizationApprovalRequestRead]:
    """Open approval requests addressed to the organization, oldest first. Members and site
    admins only."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.require_member(db, org, current_user)
    rows = approval_requests_service.list_open_for_organization(db, org=org)
    return [approval_requests_service.build_organization_read(row) for row in rows]


@router.patch("/{slug}", response_model=OrganizationRead)
@limiter.limit("30/minute")
def update_organization(
    request: Request,
    slug: str,
    body: OrganizationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrganizationRead:
    """Edit an organization's bio, links and approval request audience. Org managers and site
    admins only."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.require_manager(db, org, current_user)
    organizations_service.apply_update(org, body)
    db.commit()
    db.refresh(org)
    return organizations_service.build_read(db, org, viewer=current_user)


@router.put("/{slug}/avatar", response_model=OrganizationRead)
@limiter.limit("20/minute")
def set_organization_avatar(
    request: Request,
    slug: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrganizationRead:
    """Replace an organization's picture, under the rules of ``PUT /users/me/avatar``."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.require_manager(db, org, current_user)
        org = asyncio.run(users_service.set_avatar(db, owner=org, file=file))
    return organizations_service.build_read(db, org, viewer=current_user)


@router.delete("/{slug}/avatar", response_model=OrganizationRead)
@limiter.limit("20/minute")
def delete_organization_avatar(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrganizationRead:
    """Drop an organization's picture."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.require_manager(db, org, current_user)
    org = users_service.clear_avatar(db, owner=org)
    return organizations_service.build_read(db, org, viewer=current_user)


@router.get("/{slug}/invites", response_model=list[OrganizationInviteRead])
@limiter.limit("60/minute")
def list_organization_invites(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[OrganizationInviteRead]:
    """Pending invites, newest first. Org managers and site admins only."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.require_manager(db, org, current_user)
    return organizations_service.list_invites(db, org)


@router.get("/{slug}/invite-candidates", response_model=list[AuthorRef])
@limiter.limit("60/minute")
def list_invite_candidates(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[User]:
    """The analysts you may invite: in mutual follow with you, neither member nor invited."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.require_manager(db, org, current_user)
    return organizations_service.invite_candidates(db, org, inviter=current_user)


@router.post(
    "/{slug}/invites",
    response_model=OrganizationInviteRead,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/hour")
def create_organization_invite(
    request: Request,
    slug: str,
    body: OrganizationInviteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrganizationInviteRead:
    """Invite an analyst in mutual follow with you. Org managers only."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        row = organizations_service.invite(db, org, inviter=current_user, username=body.username)
    db.commit()
    db.refresh(row)
    return organizations_service.build_invite_read(row)


@router.delete("/{slug}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def cancel_organization_invite(
    request: Request,
    slug: str,
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Withdraw a pending invite. Org managers and site admins only."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.require_manager(db, org, current_user)
        organizations_service.cancel_invite(db, org, invite_id=invite_id)
    db.commit()


@router.post("/{slug}/invite/accept", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def accept_organization_invite(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Accept your pending invite and join as a member."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug)
        organizations_service.accept_invite(db, org, user=current_user)
    db.commit()


@router.post("/{slug}/invite/decline", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def decline_organization_invite(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Decline your pending invite."""
    with _typed_errors():
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrganizationMemberRead:
    """Change a member's role. Org managers and site admins only; the last org manager keeps the role."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug, lock=True)
        organizations_service.require_manager(db, org, current_user)
        result = organizations_service.change_role(db, org, username=username, role=body.role)
    db.commit()
    return result


@router.delete("/{slug}/members/{username}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def remove_organization_member(
    request: Request,
    slug: str,
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove a member, or leave with your own username. The last org manager cannot leave."""
    with _typed_errors():
        org = organizations_service.get_by_slug(db, slug, lock=True)
        organizations_service.remove_member(db, org, actor=current_user, username=username)
    db.commit()
