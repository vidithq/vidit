import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Media kind domain. The alias is the value-domain source of truth — the column,
# the Read schema, the tweet-import ``kind`` field, and the generated frontend
# type all derive from it.
MediaType = Literal["image", "video"]


class Media(Base):
    """File attachment owned by one geolocation event.

    Single ``geolocation_id`` owner since the bounty + geolocation merge: a
    bounty is now a ``requested`` geolocation, so all evidence hangs off the one
    table. Fulfilling a request no longer moves media between tables — the row
    already points at the event that gains a location.
    """

    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    geolocation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("geolocations.id", ondelete="CASCADE"), nullable=False
    )
    storage_url: Mapped[str] = mapped_column(Text, nullable=False)
    media_type: Mapped[MediaType] = mapped_column(String(10), nullable=False)
    # Hex-encoded SHA-256 of the uploaded bytes — a queryable content fingerprint
    # that survives storage-class changes and copies, unlike the S3 ETag (MD5 for
    # non-multipart uploads, not stable across copies). Nullable: demo-seeder rows
    # reference ``demo-pool/`` objects with no upload pass, carry NULL, and are
    # excluded from audit queries off this column.
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Provenance captured at upload time — "who submitted this, from where, under
    # what filename" without a join through ``auth_events``. All nullable:
    # pre-existing rows can't be backfilled, demo rows have no real submitter.
    uploaded_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    uploaded_user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    geolocation = relationship("Geolocation", back_populates="media")

    __table_args__ = (
        # Non-unique partial index on the populated cohort — "find every row with
        # this hash" cheaply, skipping demo rows (always NULL ``sha256``).
        Index("ix_media_sha256", "sha256", postgresql_where="sha256 IS NOT NULL"),
    )
