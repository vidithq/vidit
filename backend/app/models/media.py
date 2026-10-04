import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Media kind domain. Value-domain source of truth for the column, the Read
# schema, the tweet-import ``kind`` field and the generated frontend type.
MediaType = Literal["image", "video"]

# ``source`` is the footage (at most one per event, ``uq_media_source_per_event``);
# ``proof`` is an inline image of the proof body. No Python default: every
# writer states the role, so a forgotten one can't pass as source.
MediaRole = Literal["source", "proof"]


class Media(Base):
    """File attachment owned by one event, source footage and proof imagery alike.

    A request is a ``requested`` event, so all evidence hangs off one table and
    fulfilling a request never moves media. ``event_id`` is always set (both
    roles upload at publish; no staging row or orphan reaper).
    """

    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MediaRole] = mapped_column(String(10), nullable=False)
    storage_url: Mapped[str] = mapped_column(Text, nullable=False)
    media_type: Mapped[MediaType] = mapped_column(String(10), nullable=False)
    # Hex SHA-256 of the uploaded bytes: a content fingerprint stable across
    # copies, unlike the S3 ETag. NULL on rows predating the column.
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Sanitised client filename, public so investigators can trace evidence to a post.
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    event = relationship("Event", back_populates="media")

    __table_args__ = (
        # Mirror of ``MediaRole``; keep the two in step.
        CheckConstraint("role IN ('source', 'proof')", name="ck_media_role_valid"),
        # Partial index on the populated cohort: "every row with this hash".
        Index("ix_media_sha256", "sha256", postgresql_where="sha256 IS NOT NULL"),
        # At most one source media per event.
        Index(
            "uq_media_source_per_event",
            "event_id",
            unique=True,
            postgresql_where=text("role = 'source'"),
        ),
    )
