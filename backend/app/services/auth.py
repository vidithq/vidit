import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from sqlalchemy import case, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models.invite_code import InviteCode
from app.models.user import User


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def hash_token(token: str) -> str:
    """SHA-256 a single-use token for storage at rest.

    Tokens are high-entropy random secrets (not user-chosen), so a fast hash
    is enough — the point is that a read-only DB leak (logs, backups, snapshots)
    hands over only digests, never working live tokens. No bcrypt: there's no
    low-entropy password here to slow brute-forcing of.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Pre-computed at import so /login always pays one bcrypt regardless of
# whether the email matched a live user — otherwise the unknown-email and
# soft-deleted branches return faster than wrong-password and leak account
# state via timing. Inherits a bumped ``gensalt()`` cost on next deploy,
# but legacy hashes verify faster at the old cost, so plan a re-hash-on-
# login migration when bumping cost.
DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing-equalisation")


def create_access_token(user: User) -> str:
    """Mint a session JWT for ``user``.

    Embeds ``token_version`` as a ``tv`` claim alongside ``sub`` + ``exp``.
    ``get_current_user`` compares decoded ``tv`` against the row and 401s
    on mismatch, so bumping ``token_version`` (logout, password change,
    password reset, soft-delete) invalidates every outstanding session at
    once.
    """
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user.id), "exp": expire, "tv": user.token_version}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def bump_token_version(user: User) -> None:
    """Invalidate every outstanding session for ``user``.

    Increments ``token_version`` so every previously-minted JWT (carrying
    the old ``tv``) now 401s at ``get_current_user``. Mutates the
    in-session row only; caller commits.

    Called at logout, password change, password reset, soft-delete.
    Re-issuing a fresh cookie for the current device after a bump
    (change-password) keeps that device live while the others log out.
    """
    user.token_version = user.token_version + 1


def validate_invite_code(db: Session, code: str) -> InviteCode | None:
    """Return the row iff usable: not revoked, not expired, not exhausted."""
    invite = db.query(InviteCode).filter(InviteCode.code == code).first()
    if invite is None:
        return None
    if invite.revoked_at is not None:
        return None
    if invite.expires_at and invite.expires_at < datetime.now(UTC):
        return None
    if invite.use_count >= invite.max_uses:
        return None
    return invite


def consume_invite_code(db: Session, invite: InviteCode, user_id: uuid.UUID) -> bool:
    """Atomically bump ``use_count`` iff the code is still consumable.

    Returns ``True`` on success, ``False`` if another path consumed the
    last slot since validation. The atomic
    ``UPDATE ... WHERE use_count < max_uses ... RETURNING`` is the
    race-safety: a prior read-modify-write let two concurrent confirms both
    observe ``use_count=0`` under READ COMMITTED, both bump to 1, and create
    two users against a ``max_uses=1`` invite. Mirrors
    ``auth_tokens.consume`` (PR #41).

    Doesn't commit, so the user insert and the count bump land atomically
    with registration.
    """
    now = datetime.now(UTC)
    stmt = (
        update(InviteCode)
        .where(
            InviteCode.id == invite.id,
            InviteCode.revoked_at.is_(None),
            InviteCode.use_count < InviteCode.max_uses,
        )
        .values(
            use_count=InviteCode.use_count + 1,
            # First-consumer audit columns: set only if NULL, so multi-use
            # codes keep recording who unlocked them first.
            used_by=case(
                (InviteCode.used_by.is_(None), user_id),
                else_=InviteCode.used_by,
            ),
            used_at=case(
                (InviteCode.used_at.is_(None), now),
                else_=InviteCode.used_at,
            ),
        )
        .returning(InviteCode.id)
    )
    if db.execute(stmt).scalar_one_or_none() is None:
        return False
    # Refresh so later reads in this transaction see the bumped count +
    # audit fields.
    db.refresh(invite)
    return True


def generate_invite_code() -> str:
    return secrets.token_urlsafe(16)


def maybe_promote_admin(user: User) -> bool:
    """Flip ``is_admin`` to True if the user's email matches ADMIN_EMAILS.

    Returns True only when a write happened, so callers decide whether to
    commit. No-op if already admin or off the list. Called from /register
    (after the row exists) and /login (in case the env var changed since
    registration).
    """
    if user.is_admin:
        return False
    # An assembled profile (no email until claimed) can't match the admin list.
    if user.email is None or user.email.lower() not in settings.admin_emails_list:
        return False
    user.is_admin = True
    return True
