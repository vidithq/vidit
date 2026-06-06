"""Single-use, expiring tokens for password-reset and email-verification.

Token lifecycle
---------------

1. ``mint`` generates a high-entropy URL-safe random secret (32 bytes →
   ~43 chars), persists ``sha256(secret)`` plus the user, purpose, and
   expiry, and returns the *plaintext* secret. Only the plaintext is ever
   put on the wire (in the email link); only the hash sits in the DB.
2. The user clicks the link, the frontend POSTs the secret to the backend.
3. ``consume`` re-hashes the secret and runs a single atomic UPDATE that
   flips ``consumed_at`` only if the row is currently the right purpose,
   unconsumed, and unexpired. Zero rows updated = invalid token. The
   atomic UPDATE is the single-use enforcement — two parallel requests
   for the same token can both pass an ORM-level "is it consumed yet?"
   check under READ COMMITTED, but only one can win the row-lock race
   inside the UPDATE.

Why hash at rest? A read-only DB leak (logs, backups, snapshots) would
otherwise hand an attacker working live tokens. Hashing turns "read DB →
log in" into a problem the attacker can't solve without inverting SHA-256.

Why one shared table? Password-reset and email-verification share every
single moving part (entropy, TTL, single-use-with-expiry, indexes). One
table with a ``purpose`` column is half the migration surface, half the
code, and identical safety properties to two tables.

Single-use is enforced by the unique index on ``token_hash`` *plus* the
WHERE-clause guard inside the consume UPDATE.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import CursorResult, update
from sqlalchemy.orm import Session

from app.models.auth_token import (
    ALL_PURPOSES,
    AuthToken,
)

# 32 random bytes = 256 bits of entropy. URL-safe base64 → ~43 ASCII chars
# in the email link. Comfortably above the 128 bits typically considered
# "guess-resistant for the lifetime of the universe".
_TOKEN_BYTES = 32


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def mint(
    db: Session,
    user_id: uuid.UUID,
    purpose: str,
    ttl_minutes: int,
) -> str:
    """Mint and persist a fresh token. Returns the plaintext secret.

    Caller is responsible for committing the session — the token is not
    valid until the row hits the DB. We do NOT commit here so the caller
    can roll the email-send and the DB write into the same atomic unit
    (or at least keep them adjacent enough that an email failure leaves
    no orphan token row).
    """

    if purpose not in ALL_PURPOSES:
        raise ValueError(f"unknown auth-token purpose: {purpose!r}")

    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    row = AuthToken(
        user_id=user_id,
        token_hash=_hash(raw),
        purpose=purpose,
        expires_at=datetime.now(UTC) + timedelta(minutes=ttl_minutes),
    )
    db.add(row)
    return raw


def consume(db: Session, raw_token: str, purpose: str) -> AuthToken | None:
    """Validate + single-use-consume the token. Returns the row, or None.

    Implemented as one atomic UPDATE ... WHERE consumed_at IS NULL ...
    RETURNING — so two concurrent requests for the same token can't both
    succeed. The previous SELECT-then-mutate pattern was vulnerable under
    PostgreSQL's default READ COMMITTED isolation: both reads would see
    ``consumed_at IS NULL``, both would flip it, both commits would
    succeed, and the same single-use token could be redeemed twice. For
    password-reset that meant an attacker holding a live link could race
    the legitimate user and win.

    Returns None for *any* failure mode — unknown / wrong purpose /
    expired / already consumed / lost the race. Callers must treat all
    of these as the same opaque "invalid token" so the wire response
    doesn't leak which step rejected.
    """

    now = datetime.now(UTC)
    stmt = (
        update(AuthToken)
        .where(
            AuthToken.token_hash == _hash(raw_token),
            AuthToken.purpose == purpose,
            AuthToken.consumed_at.is_(None),
            AuthToken.expires_at >= now,
        )
        .values(consumed_at=now)
        .returning(AuthToken)
    )
    row = db.execute(stmt).scalar_one_or_none()
    return row


def revoke_all_live_for_user(db: Session, user_id: uuid.UUID, purpose: str) -> int:
    """Mark every outstanding token for (user, purpose) as consumed.

    Atomic UPDATE for the same race-safety reason as ``consume``: two
    concurrent ``forgot-password`` calls for the same user must not both
    leave a "live" token behind. Returns the number of tokens revoked.

    Used when minting a fresh password-reset or verification token: any
    older live token for the same purpose becomes unusable, so a stolen
    "old" email can't be redeemed once the user has requested a new one.
    """

    now = datetime.now(UTC)
    stmt = (
        update(AuthToken)
        .where(
            AuthToken.user_id == user_id,
            AuthToken.purpose == purpose,
            AuthToken.consumed_at.is_(None),
            AuthToken.expires_at >= now,
        )
        .values(consumed_at=now)
    )
    # CursorResult exposes rowcount; the generic Result protocol from
    # db.execute() doesn't, so the cast is just to satisfy mypy.
    result: CursorResult = db.execute(stmt)  # type: ignore[assignment]
    return result.rowcount or 0
