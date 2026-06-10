"""On-demand maintenance ops surfaced via the admin Maintenance panel.

Replaces the periodic cron scripts that lived in `backend/scripts/`.
Trade-off: an admin clicks when they remember rather than on a schedule —
fine while both ops sweep low-cost rows / objects whose backlog isn't
latency-sensitive. If a table or the S3 bill outgrows admin attention, the
move is a Railway scheduled job hitting these endpoints, not a return to
standalone scripts.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.auth_token import AuthToken
from app.models.proof_image import ProofImage
from app.services import registration as registration_service
from app.services.storage import StorageDeleteError, get_storage

logger = logging.getLogger(__name__)


# 24h grace is wider than any realistic submit latency, so an in-flight
# submit can't have its image reaped from under it.
PROOF_ORPHAN_GRACE_HOURS = 24

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


def reap_proof_image_orphans(db: Session) -> dict[str, int]:
    """Drop proof_images rows + S3 objects for abandoned uploads.

    A row is an orphan if the user uploaded the image from the editor but
    never submitted a geolocation linking it (form abandoned, retry with
    different images, browser crash). The 24h grace prevents reaping a row
    out from under an in-flight submit.

    Returns counts of rows deleted, S3 objects deleted, and per-key S3
    failures (rows for failed deletes are kept so the next sweep retries).
    """
    cutoff = datetime.now(UTC) - timedelta(hours=PROOF_ORPHAN_GRACE_HOURS)

    orphans = (
        db.query(ProofImage)
        .filter(
            ProofImage.geolocation_id.is_(None),
            ProofImage.created_at < cutoff,
        )
        .all()
    )
    if not orphans:
        return {"rows_deleted": 0, "s3_deleted": 0, "s3_failed": 0}

    keys = [row.s3_key for row in orphans]
    failed_keys: set[str] = set()
    try:
        get_storage().delete_many(keys)
    except StorageDeleteError as exc:
        failed_keys = set(exc.errors)
        logger.warning(
            "proof-image reaper: %d/%d S3 deletes failed; keeping their rows for retry",
            len(failed_keys),
            len(keys),
        )
    logger.info(
        "proof-image reaper: %d/%d S3 objects deleted",
        len(keys) - len(failed_keys),
        len(keys),
    )

    succeeded_ids = [row.id for row in orphans if row.s3_key not in failed_keys]
    rows_deleted = 0
    if succeeded_ids:
        # Re-assert geolocation_id IS NULL inside the DELETE: guards the
        # narrow race where a user links one of these rows between the
        # SELECT above and this DELETE, which would otherwise silently drop
        # a now-linked row.
        rows_deleted = (
            db.query(ProofImage)
            .filter(
                ProofImage.id.in_(succeeded_ids),
                ProofImage.geolocation_id.is_(None),
            )
            .delete(synchronize_session=False)
        )
        db.commit()

    return {
        "rows_deleted": rows_deleted or 0,
        "s3_deleted": len(keys) - len(failed_keys),
        "s3_failed": len(failed_keys),
    }


def reap_pending_registrations(db: Session) -> dict[str, int]:
    """Drop expired ``pending_registrations`` rows.

    A pending row holds the address until the user confirms or the TTL
    expires. The create path also sweeps inline, so this button mostly mops
    up rows from users who never came back, keeping the address pool open
    for legitimate retries.
    """
    return registration_service.reap_pending_registrations(db)
