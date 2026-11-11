import uuid
from typing import Literal

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, literal_check

MediaKind = Literal["image", "video"]

MediaRole = Literal["source", "proof"]


class Media(Base):
    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE")
    )
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    storage_url: Mapped[str] = mapped_column(Text)
    kind: Mapped[MediaKind] = mapped_column(String(10))
    sha256: Mapped[str] = mapped_column(String(64))
    original_filename: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[CreatedAt]

    event = relationship("Event", back_populates="media")
    source = relationship("Source", back_populates="media")

    @property
    def role(self) -> MediaRole:
        return "source" if self.source_id is not None or self.source is not None else "proof"

    __table_args__ = (
        literal_check("kind", MediaKind, "ck_media_kind_valid"),
        UniqueConstraint("source_id", name="uq_media_source_id"),
        CheckConstraint("num_nonnulls(source_id, event_id) = 1", name="ck_media_one_parent"),
        Index("ix_media_sha256", "sha256"),
        Index("ix_media_storage_url", "storage_url"),
    )
