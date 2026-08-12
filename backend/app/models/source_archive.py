import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Where the link was found on the event. ``source_url`` is the event's declared
# footage source (the column of the same name); ``secondary_source`` is one of
# the analyst-submitted mirrors in ``event_source_links``; ``proof_link`` is an
# href carried by a link mark inside the proof body's Tiptap document.
SourceArchiveOrigin = Literal["source_url", "secondary_source", "proof_link"]

# Lifecycle of one link's archival, shared by both providers: the row is one
# job, not two. ``queued`` — waiting for the worker, with ``next_attempt_at``
# gating when it becomes runnable (fresh rows are runnable immediately, retried
# rows after their backoff); ``running`` — claimed by a worker pass (a row stuck
# here past the stale window is reclaimed, see ``services/source_archive``);
# ``done`` — at least one provider captured the link and no further attempt is
# made; ``failed`` — neither provider captured it, the attempt budget is spent,
# and ``error`` carries the last reason from each. ``failed`` is a terminal
# state the read surface displays, not an internal one.
SourceArchiveStatus = Literal["queued", "running", "done", "failed"]

# The archiving services, peers rather than a primary and a fallback. Both are
# attempted for every link.
SourceArchiveProvider = Literal["wayback", "archive_today"]

# The capture column each provider writes. One home for the pairing, so every
# caller iterates providers instead of restating which column is whose.
PROVIDER_COLUMNS: dict[SourceArchiveProvider, str] = {
    "wayback": "wayback_url",
    "archive_today": "archive_today_url",
}


class SourceArchive(Base):
    """One link on one event, and where its archived copies live.

    A child table rather than a column on ``events`` because one event carries
    several links: its ``source_url``, its secondary source links, and every
    href in the proof body. The
    row is both the queue job and the result: ``services/source_archive``
    claims ``queued`` rows with ``FOR UPDATE SKIP LOCKED``, calls both archiving
    services, and stamps their capture columns in place. Postgres is the queue,
    the same shape the archive-import worker uses, so a link never needs a
    second table to be retried and the read surface never joins two.

    One row per link, not one per (link, provider): the two providers share a
    lifecycle. A pass attempts whichever capture columns are still empty, and
    the first capture to land ends the job, so the other column is left as it
    is rather than retried. Two rows would give one link two attempt counters
    and two backoff schedules for a result the read surface renders as one
    thing.

    ``(event_id, original_url)`` is unique: enqueueing an event whose links
    are already tracked is a no-op, which is what makes create-time enqueue,
    the edit path, and the catalog backfill all safe to run repeatedly.
    """

    __tablename__ = "source_archives"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The link as it appears on the event, byte for byte: it is half the
    # identity of the row and what the read surface matches ``source_url``
    # against, so it is never normalised.
    original_url: Mapped[str] = mapped_column(Text, nullable=False)
    origin: Mapped[SourceArchiveOrigin] = mapped_column(String(20), nullable=False)
    status: Mapped[SourceArchiveStatus] = mapped_column(
        String(10), nullable=False, default="queued"
    )
    # The two capture columns, one per provider, filled independently. At least
    # one is non-NULL exactly when ``status='done'``; both are NULL in every
    # other state. A ``done`` row with one column empty is settled, not
    # half-finished: that provider refused and is not retried.
    wayback_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    archive_today_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Terse operator-facing reason for the last attempt, one clause per provider
    # that refused (``wayback: rate limited; archive.today: no snapshot``).
    # Kept on a row that goes back to ``queued``, so a retry history is readable
    # while the row is in flight, and on a ``done`` row where one provider
    # failed, since it is the only record of why that column is empty.
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # When the row becomes claimable. Set to now at insert and pushed out by
    # the exponential backoff after each failed attempt; the archiving
    # services rate-limit hard, so a failed link waits rather than spinning.
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event = relationship("Event", back_populates="archives")

    __table_args__ = (
        # One row per link per event: the idempotency anchor for every enqueue
        # path (create, edit, backfill).
        UniqueConstraint("event_id", "original_url", name="uq_source_archives_event_url"),
        # The claim query: runnable rows, oldest schedule first.
        Index("ix_source_archives_status_next_attempt", "status", "next_attempt_at"),
        # ``done`` and "carries at least one capture" are the same fact, in both
        # directions: a read surface can treat a non-NULL capture column as
        # usable without also checking the status, a ``done`` row can never be
        # empty, and a ``failed`` row can never hold a capture, which is what
        # makes ``failed`` a displayable "not archived" state.
        CheckConstraint(
            "(status = 'done'"
            " AND (wayback_url IS NOT NULL OR archive_today_url IS NOT NULL))"
            " OR (status <> 'done'"
            " AND wayback_url IS NULL AND archive_today_url IS NULL)",
            name="ck_source_archives_done_capture",
        ),
        # Pin the value domains at the DB, not just the app-layer Literals.
        # Mirrors ``SourceArchiveStatus`` / ``SourceArchiveOrigin``; keep them
        # in step.
        CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')",
            name="ck_source_archives_status_valid",
        ),
        CheckConstraint(
            "origin IN ('source_url', 'secondary_source', 'proof_link')",
            name="ck_source_archives_origin_valid",
        ),
    )
