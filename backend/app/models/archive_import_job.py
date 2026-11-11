import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt, literal_check

ArchiveImportJobStatus = Literal["queued", "running", "done", "failed"]


class ArchiveImportJob(Base):
    __tablename__ = "archive_import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    zip_key: Mapped[str] = mapped_column(Text)
    status: Mapped[ArchiveImportJobStatus] = mapped_column(String(10), default="queued", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    estimated_post_count: Mapped[int | None] = mapped_column(Integer)
    processed_detection_count: Mapped[int] = mapped_column(Integer, default=0)
    detection_count: Mapped[int | None] = mapped_column(Integer)
    created_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[CreatedAt]
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]

    __table_args__ = (
        literal_check("status", ArchiveImportJobStatus, "ck_archive_import_jobs_status_valid"),
    )
