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

# Lifecycle of one link's archival. ``queued`` — waiting for the worker, with
# ``next_attempt_at`` gating when it becomes runnable (fresh rows are runnable
# immediately, retried rows after their backoff); ``running`` — claimed by a
# worker pass (a row stuck here past the stale window is reclaimed, see
# ``services/source_archive``); ``done`` — ``archived_url`` is final;
# ``failed`` — the attempt budget is spent and ``error`` carries the reason.
SourceArchiveStatus = Literal["queued", "running", "done", "failed"]

# Which archiving service produced ``archived_url``.
SourceArchiveProvider = Literal["wayback", "archive_today"]


class SourceArchive(Base):
    """One link on one event, and where its archived copy lives.

    A child table rather than a column on ``events`` because one event carries
    several links: its ``source_url``, its secondary source links, and every
    href in the proof body. The
    row is both the queue job and the result: ``services/source_archive``
    claims ``queued`` rows with ``FOR UPDATE SKIP LOCKED``, calls the archiving
    service, and stamps ``archived_url`` in place. Postgres is the queue, the
    same shape the archive-import worker uses, so a link never needs a second
    table to be retried and the read surface never joins two.

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
    # The archived copy, set exactly when ``status='done'``. Rendered as the
    # fallback next to the source link once the original dies.
    archived_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider: Mapped[SourceArchiveProvider | None] = mapped_column(String(20), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Terse operator-facing reason for the last failure. Kept on a row that
    # goes back to ``queued`` too, so a retry history is readable while the
    # row is still in flight.
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
        # ``archived_url`` is set exactly when the row is ``done``, so a read
        # surface can treat a non-NULL value as a usable capture without also
        # checking the status, and a ``done`` row can never be empty.
        CheckConstraint(
            "(status = 'done' AND archived_url IS NOT NULL)"
            " OR (status <> 'done' AND archived_url IS NULL)",
            name="ck_source_archives_done_url",
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
