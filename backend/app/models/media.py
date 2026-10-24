import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check

# Media kind domain. Value-domain source of truth for the column, the Read
# schema, the tweet-import ``kind`` field and the generated frontend type.
MediaKind = Literal["image", "video"]

# Which parent a media row hangs off, derived from the set foreign key: a source's file, or an
# inline image of an event's proof body. Served on ``MediaRead`` and the cover tile, and read by
# the storage sweeps (only a source image has hero and thumbnail derivatives).
MediaRole = Literal["source", "proof"]


class Media(Base):
    """One stored file: a source's file, or an inline image of an event's proof body.

    Exactly one of ``source_id`` and ``event_id`` is set (``ck_media_one_parent``). Several rows
    may name one stored object: adding an existing source to another event copies the row, not
    the object, so an object is deleted only when no row references it
    (``services/evidence_intake.sweep_unreferenced``).
    """

    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The source this file belongs to; one file per source.
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), nullable=True
    )
    # The event whose proof body displays this image.
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True
    )
    storage_url: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[MediaKind] = mapped_column(String(10), nullable=False)
    # Hex SHA-256 of the uploaded bytes: a content fingerprint stable across
    # copies, unlike the S3 ETag.
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Sanitised client filename, public so investigators can trace evidence to a post.
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    event = relationship("Event", back_populates="media")
    source = relationship("Source", back_populates="media")

    @property
    def role(self) -> MediaRole:
        return "source" if self.source_id is not None or self.source is not None else "proof"

    __table_args__ = (
        literal_check("kind", MediaKind, "ck_media_kind_valid"),
        UniqueConstraint("source_id", name="uq_media_source_id"),
        CheckConstraint("num_nonnulls(source_id, event_id) = 1", name="ck_media_one_parent"),
        # "Every row with this hash" and "every row naming this object".
        Index("ix_media_sha256", "sha256"),
        Index("ix_media_storage_url", "storage_url"),
    )
