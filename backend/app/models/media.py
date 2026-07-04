import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Media kind domain. The alias is the value-domain source of truth — the column,
# the Read schema, the tweet-import ``kind`` field, and the generated frontend
# type all derive from it.
MediaType = Literal["image", "video"]

# Role domain: ``source`` is the footage (at most one per event, enforced by
# ``uq_media_source_per_event``); ``proof`` is an inline image referenced from
# the proof body (N per event). No Python default — every writer states the
# role explicitly, so a forgotten role can't silently pass as source.
MediaRole = Literal["source", "proof"]


class Media(Base):
    """File attachment owned by one event, source footage and proof imagery alike.

    Single ``event_id`` owner since the bounty + geolocation merge: a bounty is
    a ``requested`` event, so all evidence hangs off the one table and
    fulfilling a request never moves media. ``role`` splits the footage from
    the proof-body images; both upload at publish, so ``event_id`` is always
    set (no staging row, no orphan reaper — this replaced ``proof_images``).
    """

    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MediaRole] = mapped_column(String(10), nullable=False)
    storage_url: Mapped[str] = mapped_column(Text, nullable=False)
    media_type: Mapped[MediaType] = mapped_column(String(10), nullable=False)
    # Hex-encoded SHA-256 of the uploaded bytes — a queryable content fingerprint
    # that survives storage-class changes and copies, unlike the S3 ETag (MD5 for
    # non-multipart uploads, not stable across copies). Nullable: rows that
    # pre-date the column carry NULL and are excluded from audit queries.
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Client-supplied filename, sanitised at intake. Surfaced on the public read
    # API so investigators can trace evidence back to a source post by filename.
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
        # Non-unique partial index on the populated cohort — "find every row with
        # this hash" cheaply, skipping demo rows (always NULL ``sha256``).
        Index("ix_media_sha256", "sha256", postgresql_where="sha256 IS NOT NULL"),
        # The "at most one source media per event" cap, database-enforced.
        Index(
            "uq_media_source_per_event",
            "event_id",
            unique=True,
            postgresql_where=text("role = 'source'"),
        ),
    )
