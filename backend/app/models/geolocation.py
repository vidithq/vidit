import uuid
from datetime import UTC, date, datetime

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Geolocation(Base):
    __tablename__ = "geolocations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    location = mapped_column(Geometry("POINT", srid=4326), nullable=False, index=True)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    proof = mapped_column(JSONB, nullable=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
    # Soft-delete: NULL = live row, timestamp = removed from public view.
    # Filtered out by every public read; only the admin path can act on
    # soft-deleted rows. Hard-delete (the GDPR escape hatch) actually drops
    # the row + its media + S3 objects.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Demo flag — TRUE iff created by the admin "Demo data" seeder.
    # Surfaced as a "DEMO" badge in the UI and dropped en masse by the
    # wipe button. Real analyst submissions never set this.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Provenance trace when a geolocation was promoted from a bounty.
    # Populated by the slice-2 lock-and-submit flow; the bounty's status
    # flips to ``fulfilled`` in the same transaction. The reverse lookup
    # (bounty → geolocation) goes through this column.
    originated_from_bounty_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("bounties.id", ondelete="SET NULL"), nullable=True, index=True
    )

    author = relationship("User", back_populates="geolocations")
    media = relationship("Media", back_populates="geolocation", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary="geolocation_tags", back_populates="geolocations")
    originated_from_bounty = relationship(
        "Bounty",
        foreign_keys=[originated_from_bounty_id],
        primaryjoin="Geolocation.originated_from_bounty_id == Bounty.id",
    )

    __table_args__ = (
        # Partial unique index — one geolocation per fulfilled bounty.
        # ``WHERE originated_from_bounty_id IS NOT NULL`` so standalone
        # geolocations (the common case) don't all collide on NULL.
        # Mirrors migration ``n0i2d4e6f8a0_bounty_unique_fulfillment``.
        Index(
            "uq_geolocations_originated_from_bounty_id",
            "originated_from_bounty_id",
            unique=True,
            postgresql_where="originated_from_bounty_id IS NOT NULL",
        ),
    )
