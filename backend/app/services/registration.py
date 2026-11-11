"""Pre-creation registration flow.

``POST /auth/register`` stages identity in ``pending_registrations`` and
emails a confirmation link. ``POST /auth/confirm-registration`` consumes
the token, creates the real ``users`` row, marks the invite consumed, and
logs the analyst in. No ``users`` row exists until the address is proven.

Errors distinguish "live pending verification" from "already a (live or
soft-deleted) user": registration requires an invite, so the enumeration
risk is bounded.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import CodedError
from app.models.invite_code import InviteCode
from app.models.pending_registration import PendingRegistration
from app.models.user import User
from app.schemas.admin import InviteCodeStatus
from app.services.auth import (
    consume_invite_code,
    hash_password,
    hash_token,
    invite_code_status,
    maybe_promote_admin,
    mint_token,
    validate_invite_code,
)
from app.services.users import x_handle_holder

logger = logging.getLogger(__name__)

CONFIRMATION_TOKEN_MINUTES = 60 * 24


class RegistrationError(CodedError):
    code: str = "registration_error"
    status_code = 400


class InvalidInviteError(RegistrationError):
    code = "invalid_invite"
    status_code = 400


# Confirm-time rejection names the actual reason so the analyst knows
# whether to ask for a fresh invite or just re-register.
_INVITE_REJECTION: dict[InviteCodeStatus, str] = {
    "revoked": "Invite code has been revoked.",
    "expired": "Invite code has expired.",
    "exhausted": "Invite code has already been used.",
}


class EmailAlreadyRegisteredError(RegistrationError):
    """The email already belongs to a real user (live or soft-deleted)."""

    code = "email_already_registered"
    status_code = 409


class UsernameAlreadyTakenError(RegistrationError):
    code = "username_already_taken"
    status_code = 409


class EmailPendingError(RegistrationError):
    code = "email_pending_confirmation"
    status_code = 409


class UsernamePendingError(RegistrationError):
    code = "username_pending_confirmation"
    status_code = 409


class InvalidOrExpiredTokenError(RegistrationError):
    code = "invalid_or_expired_token"
    status_code = 400


@dataclass(frozen=True)
class PendingMint:
    email: str
    raw_token: str


def _delete_expired(db: Session) -> int:
    """Drop expired pending rows so they don't pin an address."""
    now = datetime.now(UTC)
    return (
        db.query(PendingRegistration)
        .filter(PendingRegistration.expires_at < now)
        .delete(synchronize_session=False)
        or 0
    )


_PENDING_EMAIL_CONSTRAINT = "uq_pending_registrations_email"
_PENDING_USERNAME_CONSTRAINT = "uq_pending_registrations_username"
# Postgres auto-names the inline ``users`` UNIQUE constraints. Match exact
# names, not substrings: ``str(IntegrityError)`` includes the INSERT SQL, so
# a ``username`` substring matches even on an email violation.
_USERS_EMAIL_CONSTRAINT = "users_email_key"
_USERS_USERNAME_CONSTRAINT = "users_username_key"

_ALL_KNOWN_CONSTRAINTS = (
    _PENDING_EMAIL_CONSTRAINT,
    _PENDING_USERNAME_CONSTRAINT,
    _USERS_EMAIL_CONSTRAINT,
    _USERS_USERNAME_CONSTRAINT,
)


def _integrity_error_constraint(exc: IntegrityError) -> str | None:
    """Best-effort violated constraint name, or ``None`` if unknown.

    Reads psycopg's ``diag.constraint_name``, else scans the driver text
    only, never ``str(exc)`` (see the constraint-name comment above).
    """
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    name = getattr(diag, "constraint_name", None)
    if name:
        return str(name)
    text = str(orig) if orig is not None else ""
    for candidate in _ALL_KNOWN_CONSTRAINTS:
        if candidate in text:
            return candidate
    return None


def _is_username_constraint(name: str | None) -> bool:
    return name in (_PENDING_USERNAME_CONSTRAINT, _USERS_USERNAME_CONSTRAINT)


def _clash(
    exc: IntegrityError, *, username: RegistrationError, email: RegistrationError
) -> RegistrationError:
    """The error for the UNIQUE constraint ``exc`` violated. Email or unknown default to
    ``email``, rather than invent a username clash."""
    return username if _is_username_constraint(_integrity_error_constraint(exc)) else email


_EMAIL_TAKEN = "An account with this email already exists. Sign in or reset your password."
_USERNAME_TAKEN = "That username is taken."
_EMAIL_PENDING = (
    "A confirmation is already in flight for this address. Check your inbox, or request a new link."
)
_USERNAME_PENDING = (
    "That username is being claimed in another registration. "
    "Pick a different one, or wait for the other request to expire."
)


def create_pending_registration(
    db: Session,
    *,
    email: str,
    username: str,
    password: str,
    invite_code: str,
) -> PendingMint:
    """Stage a registration. Returns the raw token to email.

    The invite is checked before any uniqueness check so a probe with an
    unknown invite can't enumerate emails or usernames. The SELECT checks only
    give friendly errors; the UNIQUE constraints are the race protection.

    Caller commits. The expired-row sweep is committed here so the INSERT
    doesn't see a stale row.

    The "invalid invite" branch returns measurably faster than the others
    (timing oracle), accepted while invites gate registration.
    """
    invite = validate_invite_code(db, invite_code)
    if invite is None:
        raise InvalidInviteError("Invalid or expired invite code")

    _delete_expired(db)
    db.commit()

    # Covers soft-deleted users too: only hard-delete releases an address.
    if db.query(User).filter(User.email == email).first() is not None:
        raise EmailAlreadyRegisteredError(_EMAIL_TAKEN)
    if db.query(User).filter(User.username == username).first() is not None:
        raise UsernameAlreadyTakenError(_USERNAME_TAKEN)

    if db.query(PendingRegistration).filter(PendingRegistration.email == email).first() is not None:
        raise EmailPendingError(_EMAIL_PENDING)
    if (
        db.query(PendingRegistration).filter(PendingRegistration.username == username).first()
        is not None
    ):
        raise UsernamePendingError(_USERNAME_PENDING)

    raw_token, token_hash = mint_token()
    row = PendingRegistration(
        email=email,
        username=username,
        password_hash=hash_password(password),
        invite_code_id=invite.id,
        token_hash=token_hash,
        expires_at=datetime.now(UTC) + timedelta(minutes=CONFIRMATION_TOKEN_MINUTES),
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError as exc:
        # Concurrent register: the UNIQUE constraint caught what the checks above raced.
        db.rollback()
        raise _clash(
            exc,
            username=UsernamePendingError(_USERNAME_PENDING),
            email=EmailPendingError(_EMAIL_PENDING),
        ) from exc

    return PendingMint(email=email, raw_token=raw_token)


def resend_pending_registration(
    db: Session,
    *,
    email: str,
) -> PendingMint | None:
    """Re-mint the token of the live pending row, which voids the first email's link. None when
    no row is live; the router answers 204 either way so responses don't enumerate addresses."""
    _delete_expired(db)
    db.commit()

    row = db.query(PendingRegistration).filter(PendingRegistration.email == email).first()
    if row is None:
        return None

    raw_token, row.token_hash = mint_token()
    row.expires_at = datetime.now(UTC) + timedelta(minutes=CONFIRMATION_TOKEN_MINUTES)
    return PendingMint(email=row.email, raw_token=raw_token)


def confirm_pending_registration(db: Session, raw_token: str) -> User:
    """Consume the token, create the user, mark the invite consumed.

    The pending row is claimed with ``DELETE ... RETURNING``: concurrent
    confirms can both pass a "row exists?" check under READ COMMITTED, so
    only the DELETE enforces single use (the loser sees zero rows).

    User uniqueness is re-checked by SELECT (friendly error) with the UNIQUE
    constraint as backstop. Caller commits.
    """
    if not raw_token:
        raise InvalidOrExpiredTokenError("Invalid or expired confirmation link.")

    now = datetime.now(UTC)
    stmt = (
        delete(PendingRegistration)
        .where(
            PendingRegistration.token_hash == hash_token(raw_token),
            PendingRegistration.expires_at >= now,
        )
        .returning(
            PendingRegistration.id,
            PendingRegistration.email,
            PendingRegistration.username,
            PendingRegistration.password_hash,
            PendingRegistration.invite_code_id,
        )
    )
    claimed = db.execute(stmt).first()
    if claimed is None:
        raise InvalidOrExpiredTokenError("Invalid or expired confirmation link.")

    (
        _,
        claimed_email,
        claimed_username,
        claimed_password_hash,
        claimed_invite_id,
    ) = claimed

    # Another path may have created a colliding user since create-pending.
    if db.query(User).filter(User.email == claimed_email).first() is not None:
        db.commit()  # persist the DELETE so the dead pending row stops failing.
        raise EmailAlreadyRegisteredError(_EMAIL_TAKEN)
    if db.query(User).filter(User.username == claimed_username).first() is not None:
        db.commit()
        raise UsernameAlreadyTakenError(_USERNAME_TAKEN)

    # The invite may have been revoked or consumed since create. Each
    # rejection commits the DELETE so the address is released at once.
    invite = db.query(InviteCode).filter(InviteCode.id == claimed_invite_id).first()
    if invite is None:
        db.commit()
        raise InvalidInviteError("Invite code is no longer valid.")
    status = invite_code_status(invite)
    if status != "active":
        # ``exhausted``: a sibling pending row took the single use.
        db.commit()
        raise InvalidInviteError(_INVITE_REJECTION[status])

    user = User(
        id=uuid.uuid4(),
        username=claimed_username,
        email=claimed_email,
        password_hash=claimed_password_hash,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        # Rollback restores the pending row; a retry hits the same error and
        # the row ages out via the reaper.
        db.rollback()
        raise _clash(
            exc,
            username=UsernameAlreadyTakenError(_USERNAME_TAKEN),
            email=EmailAlreadyRegisteredError(_EMAIL_TAKEN),
        ) from exc

    if invite.x_handle is not None:
        # Copy the invite's X handle (bot-attribution link). Fail-soft if the
        # handle was taken since mint: registration still succeeds and the
        # admin x-handle endpoint repairs it.
        if x_handle_holder(db, invite.x_handle) is not None:
            logger.warning(
                "Invite %s bound x_handle %s but a user or organization already carries it; "
                "account %s created without the link",
                invite.id,
                invite.x_handle,
                user.id,
            )
        else:
            user.x_handle = invite.x_handle
            try:
                # Savepoint: a lost race on ``users_x_handle_key`` discards only the link.
                with db.begin_nested():
                    db.flush()
            except IntegrityError:
                logger.warning(
                    "Invite %s bound x_handle %s but linking raced a concurrent "
                    "holder; account %s created without the link",
                    invite.id,
                    invite.x_handle,
                    user.id,
                )
                user.x_handle = None

    if not consume_invite_code(db, invite, user.id):
        # A concurrent confirm won the race. Roll back the flushed user; the
        # restored pending row hits the "exhausted" branch on the next click.
        db.rollback()
        raise InvalidInviteError("Invite code has already been used.")

    maybe_promote_admin(user)
    db.flush()
    db.refresh(user)
    return user


def reap_pending_registrations(db: Session) -> dict[str, int]:
    deleted = _delete_expired(db)
    db.commit()
    return {"pending_registrations_deleted": deleted}
