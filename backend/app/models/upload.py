import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, literal_check
from app.models.media import MediaKind

# How long a staged file waits for the event write that references it; the reaper deletes
# the row and its object once past (``services/uploads.reap_expired_uploads``).
UPLOAD_TTL = timedelta(hours=24)


class Upload(Base):
    """A source file stored ahead of the event write that will reference it.

    The first layer of the two-layer upload: ``POST /uploads`` stores one file and returns
    this row, and an event write names it in a source's ``upload_id``. The write turns the row
    into the source's ``media`` row and deletes it, so a row here is a file no event holds yet.
    """

    __tablename__ = "uploads"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Only the uploader may reference it. CASCADE: an erasure drops the staged rows (the
    # erasure sweeps their objects first).
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[MediaKind] = mapped_column(String(10), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Sanitised client filename, carried onto the media row.
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        literal_check("kind", MediaKind, "ck_uploads_kind_valid"),
        # Backs the reaper.
        Index("ix_uploads_expires_at", "expires_at"),
    )
