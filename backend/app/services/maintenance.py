"""On-demand maintenance ops surfaced via the admin Maintenance panel.

Run by an admin click, not a schedule: the backlogs are cheap and not
latency-sensitive.
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
from app.services.event_filters import visible_events

logger = logging.getLogger(__name__)

# Consumed tokens stay for replay debugging; expired unconsumed rows are dropped at once.
AUTH_TOKEN_RETENTION_DAYS = 30


def reap_auth_tokens(db: Session) -> dict[str, int]:
    """Drop expired-unconsumed and old-consumed auth_tokens rows; returns both counts."""
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


# One click's ceiling: one provider round-trip per analyst with no resume
# marker, so request time must not scale with the analyst base. Rows are
# ordered by backlog, so the cap keeps the biggest.
COMPLETION_DIGEST_LIMIT = 200


def detections_awaiting_completion(
    db: Session, *, limit: int = COMPLETION_DIGEST_LIMIT
) -> list[tuple[User, str, int]]:
    """Every analyst holding unpublished detections, with the count.

    Who is in: not soft-deleted, active, has an address. What counts: live
    detections only. Biggest backlog first, cut at ``limit``. The address is
    returned because the ``IS NOT NULL`` filter makes it a ``str``.
    """
    rows = (
        db.query(User, User.email, func.count(Event.id))
        .join(Event, Event.owner_id == User.id)
        .filter(
            Event.status == STATUS_DETECTED,
            # Same floor as `list_detections`: a taken-down detection cannot be published.
            *visible_events(),
            User.deleted_at.is_(None),
            User.is_active.is_(True),
            User.email.isnot(None),
        )
        .group_by(User.id)
        .order_by(func.count(Event.id).desc())
        .limit(limit)
        .all()
    )
    return [(user, email, count) for user, email, count in rows]


def send_completion_digests(db: Session) -> dict[str, int]:
    """Email each analyst the count of detections still awaiting completion.

    See :func:`detections_awaiting_completion` for who gets one and the
    :data:`COMPLETION_DIGEST_LIMIT` ceiling.

    A provider failure is logged and counted, never raised, so the rest still
    send. Returns analysts notified, detections covered, and failed sends.
    """
    notified = 0
    detections = 0
    failures = 0
    for user, address, count in detections_awaiting_completion(db):
        try:
            email_service.send(
                email_service.completion_digest_email(
                    to=address,
                    count=count,
                    link=email_service.detections_link(user.username),
                )
            )
        except email_service.EmailSendError:
            failures += 1
            logger.warning("completion digest send failed for user %s", user.id, exc_info=True)
            continue
        notified += 1
        # Counted after the send: only delivered digests cover detections.
        detections += count
    return {
        "analysts_notified": notified,
        "detections_pending": detections,
        "digest_send_failures": failures,
    }
