"""Single-use, expiring tokens for password reset.

1. ``mint`` generates a high-entropy URL-safe secret, persists ``sha256(secret)`` plus
   user and expiry, and returns the plaintext. Only the plaintext goes on the wire (the
   email link); only the hash sits in the DB, so a read-only DB leak hands over no live token.
2. ``consume`` re-hashes and runs one atomic UPDATE that flips ``consumed_at`` only if the row
   is unconsumed and unexpired. Zero rows means an invalid token. Two
   parallel requests can both pass an ORM-level check under READ COMMITTED, but only one wins
   the row-lock race inside the UPDATE.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.password_reset_token import PasswordResetToken
from app.services.auth import hash_token, mint_token


def mint(
    db: Session,
    user_id: uuid.UUID,
    ttl_minutes: int,
) -> str:
    """Persist a fresh token and return its plaintext. Caller commits."""
    raw, digest = mint_token()
    db.add(
        PasswordResetToken(
            user_id=user_id,
            token_hash=digest,
            expires_at=datetime.now(UTC) + timedelta(minutes=ttl_minutes),
        )
    )
    return raw


def consume(db: Session, raw_token: str) -> PasswordResetToken | None:
    """Validate and single-use-consume the token. Returns the row, or None.

    One atomic UPDATE ... WHERE consumed_at IS NULL ... RETURNING. A SELECT-then-mutate would
    let two concurrent requests both redeem the token under READ COMMITTED (for password reset,
    an attacker holding a live link could race the legitimate user).

    Returns None for any failure (unknown, expired, consumed, lost the race).
    Callers must answer them all with the same opaque "invalid token".
    """

    now = datetime.now(UTC)
    stmt = (
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == hash_token(raw_token),
            PasswordResetToken.consumed_at.is_(None),
            PasswordResetToken.expires_at >= now,
        )
        .values(consumed_at=now)
        .returning(PasswordResetToken)
    )
    row = db.execute(stmt).scalar_one_or_none()
    return row


def revoke_all_live_for_user(db: Session, user_id: uuid.UUID) -> None:
    """Mark every outstanding token of ``user_id`` as consumed.

    Atomic UPDATE, so two concurrent ``forgot-password`` calls can't both leave a live token.
    Called when minting a fresh token, so a stolen older email can't be redeemed.
    """
    now = datetime.now(UTC)
    db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.consumed_at.is_(None),
            PasswordResetToken.expires_at >= now,
        )
        .values(consumed_at=now)
    )
