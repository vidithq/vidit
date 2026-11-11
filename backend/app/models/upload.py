import uuid
from datetime import datetime, timedelta

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt, literal_check
from app.models.media import MediaKind

UPLOAD_TTL = timedelta(hours=24)


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(Text)
    kind: Mapped[MediaKind] = mapped_column(String(10))
    sha256: Mapped[str] = mapped_column(String(64))
    original_filename: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[CreatedAt]
    expires_at: Mapped[datetime]

    __table_args__ = (
        literal_check("kind", MediaKind, "ck_uploads_kind_valid"),
        Index("ix_uploads_expires_at", "expires_at"),
    )
