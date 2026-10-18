"""Invite codes an analyst mints from Settings, each bound to the invitee's X handle.

A sponsored code is an ordinary ``invite_codes`` row with ``created_by`` set, so registration
redeems it like an admin-minted one. Minting is capped per sponsor per UTC day and gated by the
admin switch ``users.invite_minting_enabled``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.invite_code import InviteCode
from app.models.user import User
from app.schemas.invite_code import SponsoredInviteCodeList, SponsoredInviteCodeRead
from app.services.admin import log_admin_event, revoke_invite_code
from app.services.auth import generate_invite_code, invite_code_status
from app.services.email_layout import app_url

DAILY_MINT_LIMIT = 5


class SponsoredInviteError(Exception):
    code: str = "sponsored_invite_error"


class InviteMintingDisabledError(SponsoredInviteError):
    code = "invite_minting_disabled"


class InviteQuotaExceededError(SponsoredInviteError):
    code = "invite_quota_exceeded"


class InviteCodeNotFoundError(SponsoredInviteError):
    code = "invite_code_not_found"


class InviteCodeNotActiveError(SponsoredInviteError):
    code = "invite_code_not_active"


ERROR_STATUS: dict[str, int] = {
    InviteMintingDisabledError.code: 403,
    InviteCodeNotFoundError.code: 404,
    InviteCodeNotActiveError.code: 409,
    InviteQuotaExceededError.code: 429,
}


def _quota_window(now: datetime) -> tuple[datetime, datetime]:
    start = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def _minted_since(db: Session, sponsor_id: uuid.UUID, start: datetime) -> int:
    # Every row counts, revoked or used, so revoking a code never frees a slot.
    return (
        db.query(func.count(InviteCode.id))
        .filter(InviteCode.created_by == sponsor_id, InviteCode.created_at >= start)
        .scalar()
        or 0
    )


def _read(invite: InviteCode) -> SponsoredInviteCodeRead:
    assert invite.x_handle is not None
    return SponsoredInviteCodeRead(
        id=invite.id,
        code=invite.code,
        link=app_url(f"/register?{urlencode({'code': invite.code})}"),
        x_handle=invite.x_handle,
        status=invite_code_status(invite),
        created_at=invite.created_at,
        used_at=invite.used_at,
    )


def mint(db: Session, *, sponsor: User, x_handle: str) -> SponsoredInviteCodeRead:
    """Mint a single-use code bound to ``x_handle`` (already normalized), with an audit row.

    No check of who holds the handle: answering it would tell the sponsor which handle has an
    account. Redemption fails soft on a held handle, as for an admin-minted code.
    """
    # The row lock serializes two concurrent mints, which would otherwise both pass the count.
    enabled = (
        db.query(User.invite_minting_enabled)
        .filter(User.id == sponsor.id)
        .with_for_update()
        .scalar()
    )
    if not enabled:
        raise InviteMintingDisabledError("An admin turned off invite minting for your account.")
    start, resets_at = _quota_window(datetime.now(UTC))
    if _minted_since(db, sponsor.id, start) >= DAILY_MINT_LIMIT:
        raise InviteQuotaExceededError(
            f"You minted the {DAILY_MINT_LIMIT} invite codes allowed per UTC day. "
            f"The quota resets at {resets_at:%Y-%m-%d %H:%M} UTC."
        )

    invite = InviteCode(code=generate_invite_code(), x_handle=x_handle, created_by=sponsor.id)
    db.add(invite)
    db.flush()
    log_admin_event(
        db,
        actor_id=sponsor.id,
        action="invite_sponsored",
        target={"invite_code_id": str(invite.id), "x_handle": x_handle},
    )
    db.commit()
    db.refresh(invite)
    return _read(invite)


def list_own(db: Session, *, sponsor: User) -> SponsoredInviteCodeList:
    """The sponsor's codes, newest first, used or not, with the quota state."""
    start, resets_at = _quota_window(datetime.now(UTC))
    rows = (
        db.query(InviteCode)
        .filter(InviteCode.created_by == sponsor.id)
        .order_by(InviteCode.created_at.desc(), InviteCode.id.desc())
        .all()
    )
    return SponsoredInviteCodeList(
        items=[_read(row) for row in rows],
        minting_enabled=sponsor.invite_minting_enabled,
        daily_limit=DAILY_MINT_LIMIT,
        minted_today=sum(1 for row in rows if row.created_at >= start),
        resets_at=resets_at,
    )


def revoke_own(db: Session, *, sponsor: User, code_id: uuid.UUID) -> SponsoredInviteCodeRead:
    """Revoke one of the sponsor's active codes, whatever the admin minting switch says.

    Another sponsor's code 404s like an unknown id, so the endpoint never confirms a code exists.
    """
    # The row lock keeps a redemption from landing between the status check and the revoke.
    invite = (
        db.query(InviteCode)
        .filter(InviteCode.id == code_id, InviteCode.created_by == sponsor.id)
        .with_for_update()
        .first()
    )
    if invite is None:
        raise InviteCodeNotFoundError("Invite code not found.")
    status = invite_code_status(invite)
    if status != "active":
        raise InviteCodeNotActiveError(f"This invite code is {status}, so it cannot be revoked.")
    revoked = revoke_invite_code(db, actor_id=sponsor.id, invite_id=invite.id)
    assert revoked is not None
    return _read(revoked)
