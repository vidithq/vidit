"""On-demand maintenance ops surfaced via the admin Maintenance panel.

An admin clicks when they remember rather than a cron firing on a schedule.
That holds while the sweeps here cover low-cost rows / objects whose backlog
isn't latency-sensitive; if a table or the S3 bill outgrows admin attention,
the move is a Railway scheduled job hitting these endpoints, not a
standalone script.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.auth_token import AuthToken

# Consumed tokens kept for replay-debugging via the audit log; live-but-
# expired rows have no value and are dropped immediately past expiry.
AUTH_TOKEN_RETENTION_DAYS = 30


def reap_auth_tokens(db: Session) -> dict[str, int]:
    """Drop expired and old-consumed auth_tokens rows.

    Two cohorts:

    * Live but expired (`consumed_at IS NULL AND expires_at < now()`) —
      can never be redeemed, no PII (only `token_hash`).
    * Consumed and old (`consumed_at < now() - retention_days`).

    Returns counts of each cohort deleted.
    """
    now = datetime.now(UTC)
    retention_cutoff = now - timedelta(days=AUTH_TOKEN_RETENTION_DAYS)

    expired = (
        db.query(AuthToken)
        .filter(
            AuthToken.consumed_at.is_(None),
            AuthToken.expires_at < now,
        )
        .delete(synchronize_session=False)
    )
    old_consumed = (
        db.query(AuthToken)
        .filter(
            AuthToken.consumed_at.isnot(None),
            AuthToken.consumed_at < retention_cutoff,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"expired": expired or 0, "old_consumed": old_consumed or 0}
