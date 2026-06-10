"""Pre-creation registration flow.

``POST /auth/register`` stages identity in ``pending_registrations`` and
emails a confirmation link. ``POST /auth/confirm-registration`` consumes
the token, creates the real ``users`` row, marks the invite consumed, and
logs the analyst in.

Pre-creation because the previous soft-verify flow let anyone create a
``users`` row with a typoed or unowned email: that row pinned the address,
became the recovery channel for an account the typist couldn't access, and
read as an "unverified analyst" forever. Pre-creation refuses the row until
the user proves they control the address.

Errors deliberately distinguish "address has a live pending verification"
from "address already belongs to a (live or soft-deleted) user":
registration requires an invite, so the enumeration-oracle risk is bounded.
Revisit when self-registration opens to anonymous traffic.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.invite_code import InviteCode
from app.models.pending_registration import PendingRegistration
from app.models.user import User
from app.services.auth import (
    consume_invite_code,
    hash_password,
    maybe_promote_admin,
    validate_invite_code,
)

CONFIRMATION_TOKEN_MINUTES = 60 * 24  # 24h — matches old verification TTL.
_TOKEN_BYTES = 32


class RegistrationError(Exception):
    """Base for friendly errors raised back to the user.

    Carries a ``code`` so the router maps to an HTTP status without
    string-matching exception text.
    """

    code: str = "registration_error"


class InvalidInviteError(RegistrationError):
    code = "invalid_invite"


class EmailAlreadyRegisteredError(RegistrationError):
    """The email already belongs to a real user (live or soft-deleted)."""

    code = "email_already_registered"


class UsernameAlreadyTakenError(RegistrationError):
    code = "username_already_taken"


class EmailPendingError(RegistrationError):
    """A live pending registration exists for this email."""

    code = "email_pending_confirmation"


class UsernamePendingError(RegistrationError):
    code = "username_pending_confirmation"


class InvalidOrExpiredTokenError(RegistrationError):
    code = "invalid_or_expired_token"


@dataclass(frozen=True)
class PendingMint:
    """What the router needs to send the confirmation email."""

    email: str
    raw_token: str


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _delete_expired(db: Session) -> int:
    """Drop every pending row whose TTL has passed.

    Called inline by the create path so a recently-expired row doesn't pin
    its address until the next admin reaper click. Returns the rows
    deleted (for tests / logs).
    """
    now = datetime.now(UTC)
    return (
        db.query(PendingRegistration)
        .filter(PendingRegistration.expires_at < now)
        .delete(synchronize_session=False)
        or 0
    )


_PENDING_EMAIL_CONSTRAINT = "uq_pending_registrations_email"
_PENDING_USERNAME_CONSTRAINT = "uq_pending_registrations_username"
# Postgres auto-names the inline UNIQUE constraints on ``users`` as
# ``users_email_key`` / ``users_username_key``. Match exact names, not
# substrings: ``str(IntegrityError)`` includes the parametrised
# ``INSERT INTO users (..., username, ...)`` SQL, so a substring scan for
# ``username`` matches even when the violation was on the email key.
_USERS_EMAIL_CONSTRAINT = "users_email_key"
_USERS_USERNAME_CONSTRAINT = "users_username_key"

_ALL_KNOWN_CONSTRAINTS = (
    _PENDING_EMAIL_CONSTRAINT,
    _PENDING_USERNAME_CONSTRAINT,
    _USERS_EMAIL_CONSTRAINT,
    _USERS_USERNAME_CONSTRAINT,
)


def _integrity_error_constraint(exc: IntegrityError) -> str | None:
    """Best-effort extraction of the violated constraint name.

    psycopg embeds it on ``exc.orig.diag.constraint_name``. When that's
    unavailable (older drivers, non-postgres, diag-stripping variants),
    fall back to scanning *driver text only* — NOT ``str(exc)``, which
    includes the parametrised SQL column list and would match every column
    name as a substring. Unknown → ``None`` so the caller picks a safe
    default instead of mis-attributing.
    """
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    name = getattr(diag, "constraint_name", None)
    if name:
        return str(name)
    # Scan the driver's own message (str(orig)), never str(exc) — see
    # docstring.
    text = str(orig) if orig is not None else ""
    for candidate in _ALL_KNOWN_CONSTRAINTS:
        if candidate in text:
            return candidate
    return None


def _is_username_constraint(name: str | None) -> bool:
    return name in (_PENDING_USERNAME_CONSTRAINT, _USERS_USERNAME_CONSTRAINT)


def create_pending_registration(
    db: Session,
    *,
    email: str,
    username: str,
    password: str,
    invite_code: str,
) -> PendingMint:
    """Stage a registration. Returns the raw token to email.

    Lookup ordering matters: surface "invalid invite" before any uniqueness
    check so a probe with an unknown invite can't enumerate valid emails /
    usernames. Once the invite passes, real-user and pending-row collisions
    raise distinct errors — invite gating keeps this from being a free
    enumeration oracle.

    The SELECT-based uniqueness checks are friendly-error scaffolding only;
    real race protection is the UNIQUE constraints on
    ``users``/``pending_registrations`` — two concurrent registers under
    READ COMMITTED both pass the SELECTs, one wins the INSERT, the loser is
    caught by the ``IntegrityError`` branch below.

    Caller commits; doing it here would split the email-send from the row
    insert under the router's ``BackgroundTasks`` pattern. We DO commit the
    expired-row sweep so the subsequent INSERT doesn't see the stale row
    under READ COMMITTED.

    Timing-oracle caveat: the "invalid invite" branch returns after a
    single indexed lookup, measurably faster than the others. Acceptable
    while invite gating is the bottleneck; revisit when registration opens.
    """
    invite = validate_invite_code(db, invite_code)
    if invite is None:
        raise InvalidInviteError("Invalid or expired invite code")

    _delete_expired(db)
    db.commit()

    # Real-user uniqueness — covers live and soft-deleted users; a
    # soft-deleted account keeps its address bound (only hard-delete
    # releases it).
    if db.query(User).filter(User.email == email).first() is not None:
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Sign in or reset your password."
        )
    if db.query(User).filter(User.username == username).first() is not None:
        raise UsernameAlreadyTakenError("That username is taken.")

    # Pending-row uniqueness — distinguishes "check your inbox" from
    # "create a new account".
    if db.query(PendingRegistration).filter(PendingRegistration.email == email).first() is not None:
        raise EmailPendingError(
            "A confirmation is already in flight for this address. "
            "Check your inbox, or request a new link."
        )
    if (
        db.query(PendingRegistration).filter(PendingRegistration.username == username).first()
        is not None
    ):
        raise UsernamePendingError(
            "That username is being claimed in another registration. "
            "Pick a different one, or wait for the other request to expire."
        )

    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    row = PendingRegistration(
        email=email,
        username=username,
        password_hash=hash_password(password),
        invite_code_id=invite.id,
        token_hash=_hash(raw_token),
        expires_at=datetime.now(UTC) + timedelta(minutes=CONFIRMATION_TOKEN_MINUTES),
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError as exc:
        # Two concurrent /register calls slipped past the SELECTs above and
        # both hit the unique constraint. Map the failing constraint
        # (psycopg diag) back to the matching error so the loser isn't told
        # their email is "in flight" when it was their username.
        db.rollback()
        if _is_username_constraint(_integrity_error_constraint(exc)):
            raise UsernamePendingError(
                "That username is being claimed in another registration. "
                "Pick a different one, or wait for the other request to expire."
            ) from exc
        # Email OR unknown → "in flight": the safer default, since an
        # unrecognised constraint shouldn't invent a username clash.
        raise EmailPendingError(
            "A confirmation is already in flight for this address. "
            "Check your inbox, or request a new link."
        ) from exc

    return PendingMint(email=email, raw_token=raw_token)


def resend_pending_registration(
    db: Session,
    *,
    email: str,
) -> PendingMint | None:
    """Re-mint + return a new token for an outstanding pending row.

    Returns ``None`` if no live pending exists — the router always 204s
    either way, so the caller can't enumerate addresses by response shape.

    Re-minting (vs reusing the original token) kills a stolen or
    shoulder-surfed link from the first email the moment the user clicks
    "resend".
    """
    _delete_expired(db)
    db.commit()

    row = db.query(PendingRegistration).filter(PendingRegistration.email == email).first()
    if row is None:
        return None

    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    row.token_hash = _hash(raw_token)
    row.expires_at = datetime.now(UTC) + timedelta(minutes=CONFIRMATION_TOKEN_MINUTES)
    return PendingMint(email=row.email, raw_token=raw_token)


def confirm_pending_registration(db: Session, raw_token: str) -> User:
    """Consume the token, create the user, mark the invite consumed.

    *Single-use guard:* the pending row is claimed atomically with
    ``DELETE ... WHERE token_hash = ? AND expires_at >= now() RETURNING *``.
    Two concurrent confirms can both pass an ORM-level "row exists?" check
    under READ COMMITTED; only the DELETE-with-RETURNING enforces
    single-use — the loser sees zero rows and the same opaque
    ``InvalidOrExpiredTokenError``. Mirrors ``auth_tokens.consume`` (PR #41).

    Uniqueness on ``users.email`` / ``.username`` is re-checked by SELECT
    (friendly path) and the DB UNIQUE constraint (race backstop): the
    ``IntegrityError`` branch around ``db.flush()`` catches a colliding
    insert between SELECT and INSERT (e.g. an admin manually creating a row)
    and maps it to a 409 instead of a 500.

    Invite consumption is atomic via ``consume_invite_code``'s
    ``UPDATE ... WHERE use_count < max_uses RETURNING`` — a multi-use code
    losing its last slot to a concurrent confirm returns False, and we roll
    back the unflushed user insert and raise ``InvalidInviteError``.

    Returns the freshly-created ``User``. Caller commits.
    """
    if not raw_token:
        raise InvalidOrExpiredTokenError("Invalid or expired confirmation link.")

    now = datetime.now(UTC)
    # Atomic claim: one and only one caller wins this row.
    stmt = (
        delete(PendingRegistration)
        .where(
            PendingRegistration.token_hash == _hash(raw_token),
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

    _, claimed_email, claimed_username, claimed_password_hash, claimed_invite_id = claimed

    # Re-check collisions in this transaction — the narrow window where
    # another path created a colliding user between create-pending and
    # confirm. The DB UNIQUE is the backstop (caught below); this is the
    # friendly-error scaffolding.
    if db.query(User).filter(User.email == claimed_email).first() is not None:
        db.commit()  # persist the DELETE so the dead pending doesn't keep failing.
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Sign in or reset your password."
        )
    if db.query(User).filter(User.username == claimed_username).first() is not None:
        db.commit()
        raise UsernameAlreadyTakenError("That username is taken.")

    # Re-validate the invite at confirm time: between create and confirm
    # the admin could have revoked it, or another holder of the same code
    # consumed it (pasted into two browsers; re-issued to two analysts).
    # All four branches commit the DELETE so the dead pending row releases
    # its address — recovery is "re-register with a fresh invite", not
    # "wait 24h". The SELECT-to-``consume_invite_code`` window is closed by
    # the latter; this check just avoids fanning out the user insert
    # needlessly.
    invite = db.query(InviteCode).filter(InviteCode.id == claimed_invite_id).first()
    if invite is None:
        db.commit()
        raise InvalidInviteError("Invite code is no longer valid.")
    if invite.revoked_at is not None:
        db.commit()
        raise InvalidInviteError("Invite code has been revoked.")
    if invite.expires_at is not None and invite.expires_at < now:
        db.commit()
        raise InvalidInviteError("Invite code has expired.")
    if invite.use_count >= invite.max_uses:
        # Single-use code already consumed by a sibling pending row.
        # Release the address so the loser can re-register under a fresh
        # invite instead of looping against a dead one for 24h.
        db.commit()
        raise InvalidInviteError("Invite code has already been used.")

    user = User(
        id=uuid.uuid4(),
        username=claimed_username,
        email=claimed_email,
        password_hash=claimed_password_hash,
        email_verified_at=now,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        # Lost the race against another colliding user insert. Rollback also
        # restores the claimed pending row, but the email/username is now
        # genuinely taken, so a retry hits the same UNIQUE (or the SELECT
        # above) with the same friendly error; the pending row ages out via
        # the reaper.
        db.rollback()
        if _is_username_constraint(_integrity_error_constraint(exc)):
            raise UsernameAlreadyTakenError("That username is taken.") from exc
        # Email OR unknown → "already registered": safer than inventing a
        # username clash that didn't happen.
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Sign in or reset your password."
        ) from exc

    if not consume_invite_code(db, invite, user.id):
        # We checked ``use_count < max_uses`` above; reaching here means a
        # concurrent confirm won the microseconds-wide window before this
        # atomic UPDATE. Roll back to discard the just-flushed user (can't
        # commit without a consumed slot); the rollback restores the pending
        # row, so the next click re-enters, hits the
        # ``use_count >= max_uses`` branch, commits the DELETE, and frees the
        # address with a clean error.
        db.rollback()
        raise InvalidInviteError("Invite code has already been used.")

    maybe_promote_admin(user)
    db.flush()
    db.refresh(user)
    return user


def reap_pending_registrations(db: Session) -> dict[str, int]:
    """Bulk-drop expired pending rows. Exposed via the admin Maintenance panel."""
    deleted = _delete_expired(db)
    db.commit()
    return {"pending_registrations_deleted": deleted}
