"""Single-use, expiring tokens for password reset.

Only the plaintext goes on the wire (the email link); only its hash sits in the DB, so a
read-only DB leak hands over no live token.
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
    """Single-use-consume the token; None for any failure (unknown, expired, consumed, lost the
    race), which callers answer with one opaque "invalid token".

    One atomic UPDATE ... RETURNING: a SELECT-then-mutate would let two concurrent requests
    both redeem the token under READ COMMITTED, so an attacker holding a live link could race
    the legitimate user.
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
