"""On-demand maintenance ops surfaced via the admin Maintenance panel.

Replaces the periodic cron scripts that lived in `backend/scripts/`.
Trade-off: an admin clicks when they remember rather than on a schedule,
which is fine while every op here sweeps low-cost rows / objects (or, for
the archival backfill, only enqueues work the worker paces itself) whose
backlog isn't latency-sensitive. If a table or the S3 bill outgrows admin
attention, the move is a Railway scheduled job hitting these endpoints, not
a return to standalone scripts.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.auth_token import AuthToken
from app.services import registration as registration_service
from app.services import source_archive as source_archive_service

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


def reap_pending_registrations(db: Session) -> dict[str, int]:
    """Drop expired ``pending_registrations`` rows.

    A pending row holds the address until the user confirms or the TTL
    expires. The create path also sweeps inline, so this button mostly mops
    up rows from users who never came back, keeping the address pool open
    for legitimate retries.
    """
    return registration_service.reap_pending_registrations(db)


# One click's scan ceiling for the archival backfill. Bounds the request's
# wall-clock cost; the enqueue is idempotent per link, so a catalog past this
# size is covered by clicking again.
ARCHIVAL_BACKFILL_LIMIT = 5000


def enqueue_source_archival(db: Session) -> dict[str, int]:
    """Queue archival for the links of every live event that lacks it.

    The catalog backfill: events created before archival existed carry no
    ``source_archives`` rows, so nothing would ever capture their sources.
    Enqueue only, no HTTP: the worker drains the queue at its own paced rate,
    so the click returns immediately whatever the catalog size.
    """
    return source_archive_service.enqueue_catalog(db, limit=ARCHIVAL_BACKFILL_LIMIT)
