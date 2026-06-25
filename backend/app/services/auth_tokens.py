"""Single-use, expiring tokens for password-reset and email-verification.

Token lifecycle
---------------

1. ``mint`` generates a high-entropy URL-safe secret, persists
   ``sha256(secret)`` plus user/purpose/expiry, and returns the
   *plaintext*. Only the plaintext goes on the wire (the email link); only
   the hash sits in the DB.
2. The user clicks the link; the frontend POSTs the secret.
3. ``consume`` re-hashes and runs one atomic UPDATE that flips
   ``consumed_at`` only if the row is the right purpose, unconsumed, and
   unexpired. Zero rows = invalid token. Single-use is enforced by the
   unique index on ``token_hash`` *plus* this UPDATE's WHERE-clause guard:
   two parallel requests can both pass an ORM-level "consumed yet?" check
   under READ COMMITTED, but only one wins the row-lock race inside the
   UPDATE.

Hash at rest because a read-only DB leak (logs, backups, snapshots) would
otherwise hand over working live tokens; SHA-256 makes "read DB → log in"
require inverting the hash.

One shared table because password-reset and email-verification share every
moving part (entropy, TTL, single-use-with-expiry, indexes); a ``purpose``
column halves the migration + code surface with identical safety.
"""

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import CursorResult, update
from sqlalchemy.orm import Session

from app.models.auth_token import (
    ALL_PURPOSES,
    AuthToken,
)
from app.services.auth import hash_token

# 32 bytes = 256 bits of entropy → ~43 ASCII chars in the link;
# comfortably above the 128-bit guess-resistance floor.
_TOKEN_BYTES = 32


def mint(
    db: Session,
    user_id: uuid.UUID,
    purpose: str,
    ttl_minutes: int,
) -> str:
    """Mint and persist a fresh token. Returns the plaintext secret.

    Doesn't commit (the token isn't valid until the row hits the DB) so
    the caller can keep the email-send and the DB write in one atomic
    unit — an email failure then leaves no orphan token row. Caller
    commits.
    """

    if purpose not in ALL_PURPOSES:
        raise ValueError(f"unknown auth-token purpose: {purpose!r}")

    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    row = AuthToken(
        user_id=user_id,
        token_hash=hash_token(raw),
        purpose=purpose,
        expires_at=datetime.now(UTC) + timedelta(minutes=ttl_minutes),
    )
    db.add(row)
    return raw


def consume(db: Session, raw_token: str, purpose: str) -> AuthToken | None:
    """Validate + single-use-consume the token. Returns the row, or None.

    One atomic UPDATE ... WHERE consumed_at IS NULL ... RETURNING, so two
    concurrent requests can't both succeed. The previous SELECT-then-mutate
    was vulnerable under READ COMMITTED — both reads saw
    ``consumed_at IS NULL``, both flipped it, both committed, redeeming a
    single-use token twice; for password-reset, an attacker holding a live
    link could race the legitimate user and win.

    Returns None for *any* failure (unknown / wrong purpose / expired /
    already consumed / lost the race). Callers must treat all as the same
    opaque "invalid token" so the response doesn't leak which step failed.
    """

    now = datetime.now(UTC)
    stmt = (
        update(AuthToken)
        .where(
            AuthToken.token_hash == hash_token(raw_token),
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
    concurrent ``forgot-password`` calls must not both leave a live token
    behind. Returns the number revoked.

    Called when minting a fresh token so any older live token for the same
    purpose becomes unusable — a stolen "old" email can't be redeemed once
    the user requests a new one.
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
    # CursorResult exposes rowcount; the generic Result from db.execute()
    # doesn't, so the cast just satisfies mypy.
    result: CursorResult = db.execute(stmt)  # type: ignore[assignment]
    return result.rowcount or 0
