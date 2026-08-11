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

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.auth_token import AuthToken
from app.models.event import STATUS_DETECTED, Event
from app.models.user import User
from app.services import email as email_service
from app.services import registration as registration_service
from app.services import source_archive as source_archive_service

logger = logging.getLogger(__name__)

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


def drafts_awaiting_completion(db: Session) -> list[tuple[User, int]]:
    """Every analyst holding unpublished ``detected`` drafts, with the count.

    The digest's selection rule, split out so it is readable and testable on
    its own. Who is in: an account that still exists (not soft-deleted), is
    active, and has an address to write to. What counts: live drafts (never a
    soft-deleted row, never a published or closed one) that are real work, so
    seeded demo rows are excluded and an analyst holding only demo drafts is
    not written to at all. Ordered by count, biggest backlog first.
    """
    rows = (
        db.query(User, func.count(Event.id))
        .join(Event, Event.owner_id == User.id)
        .filter(
            Event.status == STATUS_DETECTED,
            Event.deleted_at.is_(None),
            Event.is_demo.is_(False),
            User.deleted_at.is_(None),
            User.is_active.is_(True),
            User.email.isnot(None),
        )
        .group_by(User.id)
        .order_by(func.count(Event.id).desc())
        .all()
    )
    return [(user, count) for user, count in rows]


def send_completion_digests(db: Session) -> dict[str, int]:
    """Email each analyst the count of drafts still awaiting completion.

    The periodic half of the completion flow: an import lands dozens of drafts
    and nothing brings the analyst back to the queue once the import mail has
    scrolled away. One message per analyst, a count and a link to their own
    queue (see :func:`drafts_awaiting_completion` for who gets one).

    A provider failure on one address is logged and counted, never raised: the
    remaining analysts still get theirs, and a digest is by definition
    re-sendable on the next run. Returns the analysts written to, the drafts
    those messages covered, and the failed sends.
    """
    notified = 0
    drafts = 0
    failures = 0
    for user, count in drafts_awaiting_completion(db):
        if user.email is None:
            continue
        drafts += count
        try:
            email_service.send(
                email_service.completion_digest_email(
                    to=user.email,
                    count=count,
                    link=email_service.detections_link(user.username),
                )
            )
        except email_service.EmailSendError:
            failures += 1
            logger.warning("completion digest send failed for user %s", user.id, exc_info=True)
            continue
        notified += 1
    return {
        "analysts_notified": notified,
        "drafts_pending": drafts,
        "digest_send_failures": failures,
    }
