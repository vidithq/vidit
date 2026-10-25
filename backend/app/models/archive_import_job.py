import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, literal_check

# Lifecycle of one uploaded archive. ``queued``: staged. ``running``: claimed
# by a worker pass (reclaimed past the stale window, ``services/archive_jobs``).
# ``done``: counts below are final. ``failed``: the run raised or the attempt
# budget is spent (``error`` is the operator-facing reason).
ArchiveImportJobStatus = Literal["queued", "running", "done", "failed"]


class ArchiveImportJob(Base):
    """One uploaded X archive awaiting (or through) the backfill worker.

    The durable half of ``POST /events/import-archive``: the endpoint stages
    the zip and inserts this row; the worker claims it, runs the backfill,
    stamps the counts and emails the owner. The staged object is deleted once
    the job leaves the queue, so the bucket never accumulates raw exports.
    """

    __tablename__ = "archive_import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Staged upload key; removed on completion or failure, so a live key implies
    # a claimable row.
    zip_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ArchiveImportJobStatus] = mapped_column(
        String(10), nullable=False, default="queued", index=True
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # ``estimated_post_count`` is a display hint from the zip metadata at enqueue. The
    # worker stamps ``detection_count`` once the exact detection count is known
    # and batches ``processed_detection_count``.
    estimated_post_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processed_detection_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    detection_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Import counts, final once ``done`` (see ``detection.Outcome``).
    created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        literal_check("status", ArchiveImportJobStatus, "ck_archive_import_jobs_status_valid"),
    )
