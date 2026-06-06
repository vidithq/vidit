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


# Pre-computed at import time so /login always pays one bcrypt regardless of
# whether the email matched a live user. Without this, the unknown-email and
# soft-deleted-user branches return faster than the wrong-password branch and
# leak account state via response time. If `bcrypt.gensalt()` cost ever bumps,
# this constant inherits the new cost on next deploy and stays in sync with
# fresh user hashes — but legacy hashes minted at the old cost will be
# verified faster, so plan a re-hash-on-login migration when bumping cost.
DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-timing-equalisation")


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def validate_invite_code(db: Session, code: str) -> InviteCode | None:
    """Return the row iff the code is currently usable (not exhausted, not
    revoked, not expired)."""
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

    Returns ``True`` on success, ``False`` if another path already
    consumed the last available slot since validation. The atomic
    ``UPDATE ... WHERE use_count < max_uses ... RETURNING`` is what
    makes this race-safe: a previous read-modify-write implementation
    let two concurrent confirmations both observe ``use_count=0`` under
    READ COMMITTED, both bump to 1, and create two users against an
    invite with ``max_uses=1``. Mirrors the
    ``auth_tokens.consume`` pattern introduced in PR #41.

    Caller is responsible for committing the surrounding transaction;
    this function does not commit so the user insert and the count
    bump land atomically with registration.
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
            # First-consumer audit columns: only set if NULL — leaving
            # them sticky on first use so multi-use codes still record
            # who unlocked them.
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
    # Refresh the ORM-cached instance so subsequent reads in the same
    # transaction see the bumped count and audit fields.
    db.refresh(invite)
    return True


def generate_invite_code() -> str:
    return secrets.token_urlsafe(16)


def maybe_promote_admin(user: User) -> bool:
    """Flip ``is_admin`` to True if the user's email matches ADMIN_EMAILS.

    Idempotent: returns True only when a write actually happened, so callers
    can decide whether to commit. No-op if already admin or if the address
    isn't on the list. Called from both /register (after the row exists) and
    /login (in case the env var changed since the user registered).
    """
    if user.is_admin:
        return False
    if user.email.lower() not in settings.admin_emails_list:
        return False
    user.is_admin = True
    return True
