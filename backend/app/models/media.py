import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Media(Base):
    """File attachment shared by Geolocation and Bounty.

    Exactly one of ``geolocation_id`` / ``bounty_id`` is non-NULL — XOR enforced
    at the model layer (CheckConstraint) and by the upload services. The
    polymorphism keeps bounty-fulfillment cheap: instead of re-uploading S3
    objects, UPDATE ``bounty_id → NULL`` and ``geolocation_id → :geo`` in place.
    """

    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    geolocation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("geolocations.id", ondelete="CASCADE"), nullable=True
    )
    bounty_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("bounties.id", ondelete="CASCADE"), nullable=True
    )
    storage_url: Mapped[str] = mapped_column(Text, nullable=False)
    media_type: Mapped[str] = mapped_column(String(10), nullable=False)
    # Hex-encoded SHA-256 of the uploaded bytes — a queryable content
    # fingerprint that survives storage-class changes and copies, unlike the S3
    # ETag (MD5 for non-multipart uploads, not stable across copies; see
    # ``services/storage.py::UploadResult``). Nullable: demo-seeder rows
    # reference ``demo-pool/`` objects with no upload pass, carry NULL, and are
    # excluded from audit queries off this column.
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Provenance captured at upload time — "who submitted this, from where,
    # under what filename" without a join through ``auth_events`` (migration
    # rationale in ``alembic/versions/r4m6n8o0p2q4_*``). All nullable:
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
    bounty = relationship("Bounty", back_populates="media")

    __table_args__ = (
        CheckConstraint(
            "(geolocation_id IS NOT NULL AND bounty_id IS NULL) "
            "OR (geolocation_id IS NULL AND bounty_id IS NOT NULL)",
            name="ck_media_exactly_one_owner",
        ),
        # Non-unique partial index on the populated cohort — "find every row
        # with this hash" cheaply, skipping demo rows (always NULL ``sha256``).
        Index("ix_media_sha256", "sha256", postgresql_where="sha256 IS NOT NULL"),
    )
