import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ProofImage(Base):
    """One row per inline image embedded in a Tiptap proof body.

    Inserted when the editor uploads an image; `geolocation_id` is set later,
    when the form is submitted and the URL survives sanitization. Rows with
    `geolocation_id IS NULL` past a grace period are orphans (abandoned form),
    reaped via the admin Maintenance panel
    (`services/maintenance.py::reap_proof_image_orphans`).

    Storing s3_key (canonical, CDN-host-stripped) rather than the full URL means
    CloudFront rotations don't strand rows, and the same column drives both
    linking-on-submit and S3 deletion-on-delete.
    """

    __tablename__ = "proof_images"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    s3_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    geolocation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=True
    )
    # Hex-encoded SHA-256 of the uploaded bytes — see ``models/media.py``
    # for the rationale. Nullable for the same reason: orphan rows
    # created in earlier releases pre-date this column and stay NULL.
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Provenance metadata captured at upload time — same shape as
    # ``Media`` (see ``models/media.py`` for the full rationale).
    uploaded_ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    uploaded_user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_proof_images_user_id", "user_id"),
        Index("ix_proof_images_geolocation_id", "geolocation_id"),
        # Reaper scans orphans (geolocation_id IS NULL) by created_at; the
        # partial index keeps it cheap as linked rows accumulate.
        Index(
            "ix_proof_images_orphans_created_at",
            "created_at",
            postgresql_where="geolocation_id IS NULL",
        ),
        # Partial index on the populated cohort — mirrors ``ix_media_sha256``.
        Index(
            "ix_proof_images_sha256",
            "sha256",
            postgresql_where="sha256 IS NOT NULL",
        ),
    )
