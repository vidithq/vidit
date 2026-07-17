import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Lifecycle of one uploaded archive. ``queued`` — staged, waiting for the
# worker; ``running`` — claimed by a worker pass (a row stuck here past the
# stale window is reclaimed, see ``services/archive_jobs``); ``done`` — the
# backfill ran and the counts below are final; ``failed`` — the run raised or
# the attempt budget is spent (``error`` carries the operator-facing reason).
ArchiveImportJobStatus = Literal["queued", "running", "done", "failed"]


class ArchiveImportJob(Base):
    """One uploaded X archive awaiting (or through) the backfill worker.

    The durable half of ``POST /events/import-archive``: the endpoint stages
    the zip to storage and inserts this row, the worker service claims it,
    runs the backfill, stamps the assemble counts, and emails the owner. The
    row survives API and worker restarts; the staged object is deleted once
    the job leaves the queue (both outcomes), so the bucket never accumulates
    raw exports.
    """

    __tablename__ = "archive_import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Storage key of the staged upload; the object is removed when the job
    # completes or fails, so a live key implies a claimable row.
    zip_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ArchiveImportJobStatus] = mapped_column(
        String(10), nullable=False, default="queued", index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Analyst-facing progress. ``post_estimate`` comes free from the zip
    # metadata at enqueue (declared tweets.js size over the per-record
    # average), a display hint, never a contract. The worker stamps
    # ``progress_total`` once the parse gives the exact detection count and
    # batches ``progress_done`` as rows land, so the upload page's poll can
    # render "137 / 412".
    post_estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    progress_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Assemble counts, final once ``done`` (see ``AssembleOutcome``).
    created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recreated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
