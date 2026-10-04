import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import settings
from app.models.invite_code import InviteCode
from app.models.user import User
from app.schemas.admin import InviteCodeStatus
from app.schemas.auth import PASSWORD_MAX_BYTES


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    # ``surrogatepass`` keeps a lone surrogate from raising; it matches no hash, so it ends as a
    # mismatch.
    encoded = password.encode("utf-8", "surrogatepass")
    # bcrypt raises past PASSWORD_MAX_BYTES and no password is that long, so it is a mismatch.
    # It still pays one bcrypt check, so it costs what a wrong password costs.
    matches = bcrypt.checkpw(encoded[:PASSWORD_MAX_BYTES], hashed.encode("utf-8"))
    return matches and len(encoded) <= PASSWORD_MAX_BYTES


def hash_token(token: str) -> str:
    """SHA-256 a single-use token for storage at rest.

    Tokens are high-entropy random secrets, so a fast hash is enough: a read-only DB leak hands
    over only digests. No bcrypt, since there is no low-entropy password to slow down.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Pre-computed at import so /login pays one bcrypt even when the email matched no live user;
# otherwise those branches return faster than a wrong password and leak account state via
# timing. Bumping ``gensalt()`` cost needs a re-hash-on-login migration, since legacy hashes
# verify faster at the old cost.
DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing-equalisation")


def create_access_token(user: User) -> str:
    """Mint a session JWT for ``user``.

    Embeds ``token_version`` as a ``tv`` claim. ``get_current_user`` 401s on a mismatch, so
    bumping ``token_version`` invalidates every outstanding session at once.
    """
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user.id), "exp": expire, "tv": user.token_version}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_session_token_with_reason(token: str) -> tuple[dict[str, Any] | None, str | None]:
    """:func:`decode_session_token`, plus PyJWT's message for the failure.

    The reason is for a log line only: returning it over the wire would tell an attacker
    whether a leaked token is live or merely expired. ``/auth/logout`` is the one consumer; it
    WARNs on a rejected cookie so a forged one is greppable.
    """
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]), None
    except jwt.InvalidTokenError as exc:
        return None, str(exc)


def decode_session_token(token: str) -> dict[str, Any] | None:
    """Verify and decode a session JWT; ``None`` when it isn't valid.

    The one place the session secret and algorithm are read on the way in. ``None`` covers
    every ``InvalidTokenError`` mode, so callers get one opaque outcome; use
    :func:`decode_session_token_with_reason` to log which.

    Claims are returned unchecked: the account behind ``sub`` may be soft-deleted, deactivated
    or carry a stale ``tv``, which ``dependencies.get_current_user`` enforces.
    """
    payload, _reason = decode_session_token_with_reason(token)
    return payload


def bump_token_version(user: User) -> None:
    """Invalidate every outstanding session for ``user``.

    Increments ``token_version``, so every earlier JWT 401s at ``get_current_user``. Mutates the
    in-session row only; caller commits. Called at logout, password change, password reset and
    soft-delete. Re-issuing a cookie after a bump keeps the current device live.
    """
    user.token_version = user.token_version + 1


def invite_code_status(invite: InviteCode) -> InviteCodeStatus:
    """Classify an invite code: ``active`` or the reason it isn't.

    The single home for "is this code usable" (registration gates, the admin invite list,
    :func:`validate_invite_code`). Revocation outranks expiry outranks exhaustion.
    """
    if invite.revoked_at is not None:
        return "revoked"
    if invite.expires_at is not None and invite.expires_at < datetime.now(UTC):
        return "expired"
    if invite.used_at is not None:
        return "exhausted"
    return "active"


def validate_invite_code(db: Session, code: str) -> InviteCode | None:
    """Return the row iff usable: not revoked, not expired, not exhausted."""
    invite = db.query(InviteCode).filter(InviteCode.code == code).first()
    if invite is None or invite_code_status(invite) != "active":
        return None
    return invite


def consume_invite_code(db: Session, invite: InviteCode, user_id: uuid.UUID) -> bool:
    """Atomically stamp the code as redeemed iff it is still consumable.

    Returns ``True`` on success, ``False`` if another path redeemed it since validation. The
    atomic ``UPDATE ... WHERE used_at IS NULL ... RETURNING`` is the race safety: a
    read-modify-write let two concurrent confirms create two users on one code under READ
    COMMITTED. Mirrors ``auth_tokens.consume``.

    Doesn't commit, so the user insert and the redemption land atomically.
    """
    stmt = (
        update(InviteCode)
        .where(
            InviteCode.id == invite.id,
            InviteCode.revoked_at.is_(None),
            InviteCode.used_at.is_(None),
        )
        .values(used_by=user_id, used_at=datetime.now(UTC))
        .returning(InviteCode.id)
    )
    if db.execute(stmt).scalar_one_or_none() is None:
        return False
    # Refresh so later reads in this transaction see the audit fields.
    db.refresh(invite)
    return True


def generate_invite_code() -> str:
    return secrets.token_urlsafe(16)


def maybe_promote_admin(user: User) -> bool:
    """Flip ``is_admin`` to True if the user's email matches ADMIN_EMAILS.

    Returns True only when a write happened, so callers decide whether to commit. Called from
    /register and /login (in case the env var changed since registration).
    """
    if user.is_admin:
        return False
    # A credential-less legacy row (no email) can't match the admin list.
    if user.email is None or user.email.lower() not in settings.admin_emails_list:
        return False
    user.is_admin = True
    return True
