"""Pre-creation registration flow.

``POST /auth/register`` stages identity in ``pending_registrations`` and
emails a confirmation link. ``POST /auth/confirm-registration`` consumes
the token, creates the real ``users`` row, marks the invite consumed,
and logs the analyst in.

Why pre-creation? With the previous soft-verify flow, anyone could create
a ``users`` row with a typoed or unowned email. That row pinned the
address, became the recovery channel for an account the typing user
could no longer access, and read as an "unverified analyst" forever
unless someone manually deleted it. The pre-creation flow refuses to
create the row until the user proves they control the address.

Errors are deliberately distinct between "address has a live pending
verification" and "address already belongs to a live or soft-deleted
user" — closed beta registration requires an invite, so the
enumeration-oracle risk is bounded and the UX gain from a real
explanation is worth the trade. Revisit when self-registration
opens to anonymous traffic.
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

    Carries a ``code`` so the router can map to a specific HTTP status
    and message without string-matching exception text.
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

    Called inline by the create path so a recently-expired pending row
    doesn't pin its address until the next admin reaper click. Returns
    the number of rows deleted (mostly for tests / logs).
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
# Postgres auto-names the UNIQUE constraints declared inline on the
# ``users`` table as ``users_email_key`` / ``users_username_key``. We
# match exact names rather than substrings because ``str(IntegrityError)``
# includes the parametrised ``INSERT INTO users (..., username, ...)``
# SQL — any substring scan for ``username`` would always match, even
# when the actual violation was on the email key.
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

    psycopg embeds it on ``exc.orig.diag.constraint_name``. When that
    isn't available (older drivers, non-postgres, SQLAlchemy variants
    that strip diag), we fall back to scanning *driver text only* —
    NOT ``str(exc)``, which includes the parametrised SQL with the
    column list and would always match every column name as a
    substring. An unknown error returns ``None`` so the caller can
    pick a safe default instead of mis-attributing the failure.
    """
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    name = getattr(diag, "constraint_name", None)
    if name:
        return str(name)
    # Fallback: scan the driver's own message (str(orig)) for a known
    # constraint name. NEVER str(exc) — see docstring.
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

    Lookup ordering is important: we surface "invalid invite" before any
    uniqueness check so a probe with an unknown invite cannot enumerate
    valid emails / usernames. After the invite passes, both real-user
    and pending-row collisions raise distinct errors so the user gets a
    useful message — invite gating keeps this from being a free
    enumeration oracle.

    *Race-safety note:* the SELECT-based uniqueness checks below are
    friendly-error scaffolding only. Real race protection comes from
    the UNIQUE constraints on ``users.email`` / ``users.username`` and
    ``pending_registrations.email`` / ``.username``: two concurrent
    register calls under READ COMMITTED can both pass the SELECTs and
    only one will win the INSERT, with the loser caught by the
    ``IntegrityError`` branch below.

    Caller is responsible for committing the session; doing it here
    would split the eventual email-send from the row insert under the
    ``BackgroundTasks`` pattern used in the router. We DO commit the
    expired-row sweep below so the subsequent INSERT does not see the
    stale row under READ COMMITTED.

    Known timing-oracle caveat: the "invalid invite" branch returns
    after a single indexed lookup and is measurably faster than the
    other error branches. Acceptable in closed beta (invite gating is
    the bottleneck); revisit when registration opens.
    """
    invite = validate_invite_code(db, invite_code)
    if invite is None:
        raise InvalidInviteError("Invalid or expired invite code")

    _delete_expired(db)
    db.commit()

    # Real-user uniqueness — covers both live and soft-deleted users; a
    # soft-deleted account keeps its address bound (only hard-delete
    # releases it back to the pool).
    if db.query(User).filter(User.email == email).first() is not None:
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Sign in or reset your password."
        )
    if db.query(User).filter(User.username == username).first() is not None:
        raise UsernameAlreadyTakenError("That username is taken.")

    # Pending-row uniqueness — distinguish the "check your inbox" branch
    # from the "create a new account" branch for the user.
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
        # Two concurrent /register calls slipped past the application-
        # layer SELECTs above and both reached the unique constraint.
        # The DB tells us which constraint failed via psycopg's diag —
        # map it back to the matching friendly error so the loser sees
        # the right message instead of being told their email is "in
        # flight" when it was actually their username.
        db.rollback()
        if _is_username_constraint(_integrity_error_constraint(exc)):
            raise UsernamePendingError(
                "That username is being claimed in another registration. "
                "Pick a different one, or wait for the other request to expire."
            ) from exc
        # Email constraint OR unknown → "in flight" message. The
        # default is the safer mis-attribution: an unknown driver /
        # unrecognised constraint should not invent a username clash
        # that didn't happen.
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

    Returns ``None`` if no live pending exists — the router treats both
    branches identically (always 204) so the caller can't enumerate
    addresses by response shape.

    Re-minting (rather than reusing the original token) means a stolen
    or shoulder-surfed link from the first email is dead the moment
    the user clicks "resend".
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
    ``DELETE ... WHERE token_hash = ? AND expires_at >= now()
    RETURNING *``. Two concurrent confirms with the same token can
    both pass an ORM-level "does this row exist?" check under READ
    COMMITTED; only the DELETE-with-RETURNING enforces single-use —
    the loser sees zero rows and gets the same opaque
    ``InvalidOrExpiredTokenError`` as any other failure. Mirrors
    ``auth_tokens.consume`` (PR #41).

    Uniqueness on ``users.email`` / ``users.username`` is re-checked
    by SELECT for the friendly-error path and by the DB UNIQUE
    constraint as the race backstop: the ``IntegrityError`` branch
    around ``db.flush()`` catches the (narrow) window where another
    path inserts a colliding user between SELECT and INSERT, e.g. an
    admin manually creating a row, and maps it back to the matching
    409 instead of a 500.

    Invite consumption is atomic via
    ``consume_invite_code``'s ``UPDATE ... WHERE use_count < max_uses
    RETURNING`` — a multi-use code that loses its last slot to a
    concurrent confirm returns False, and we abort by rolling back the
    user insert (the row was added to the session but never flushed)
    and raising ``InvalidInviteError``.

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

    # Re-check collisions inside the same transaction — covers the
    # narrow window where another path created a user with the same
    # email or username between create-pending and confirm. The DB
    # UNIQUE on ``users.email`` is the backstop (caught below); this
    # is the friendly-error scaffolding.
    if db.query(User).filter(User.email == claimed_email).first() is not None:
        db.commit()  # persist the DELETE so the dead pending doesn't keep failing.
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Sign in or reset your password."
        )
    if db.query(User).filter(User.username == claimed_username).first() is not None:
        db.commit()
        raise UsernameAlreadyTakenError("That username is taken.")

    # Re-validate the invite at confirmation time. Between create and
    # confirm the admin could have revoked the code, or it could have
    # been consumed by another holder of the same code (the same code
    # pasted into two browsers; the admin re-issuing a code to two
    # analysts). All four branches commit the DELETE so the dead
    # pending row releases its address — the user's recovery path is
    # "re-register with a fresh invite", not "wait 24h for the row to
    # expire". The narrow window between the use_count SELECT here and
    # the atomic ``consume_invite_code`` below is closed by the latter
    # — but having an explicit check at this layer prevents the user
    # insert from fanning out unnecessarily.
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
        # Single-use code already consumed by a sibling pending row
        # (same invite pasted into two browsers; admin re-issuing the
        # same code). Release the address so the loser can re-register
        # under a fresh invite instead of being stuck in a retry loop
        # against a dead invite for the next 24h.
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
        # Lost the race against another path inserting a colliding
        # user. Rollback also restores the claimed pending row, but
        # since the email/username is now genuinely taken, a retry
        # will hit the same UNIQUE on the user INSERT (or the SELECT
        # check above) and produce the same friendly error. The
        # pending row simply ages out via the reaper.
        db.rollback()
        if _is_username_constraint(_integrity_error_constraint(exc)):
            raise UsernameAlreadyTakenError("That username is taken.") from exc
        # Email constraint OR unknown → "already registered". Safer
        # default than inventing a username clash that didn't happen.
        raise EmailAlreadyRegisteredError(
            "An account with this email already exists. Sign in or reset your password."
        ) from exc

    if not consume_invite_code(db, invite, user.id):
        # We already checked ``use_count < max_uses`` above; reaching
        # this branch means a concurrent confirm slipped through the
        # microseconds-wide window between that SELECT and this atomic
        # UPDATE. Roll back to discard the just-flushed user (we can't
        # commit them without a consumed invite slot). The pending row
        # is also restored by the rollback; the user's next click on
        # the email link will re-enter this function, hit the
        # ``use_count >= max_uses`` branch above, commit the DELETE,
        # and return the address to the pool with a clean error.
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
