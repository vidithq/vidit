import uuid
from datetime import UTC, date, datetime, time
from typing import Literal

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text, Time, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Lifecycle states. ``validated`` is the default — every human submit and bounty
# fulfilment is born validated and immutable. ``detected`` is the machine path:
# visible on every read surface but clearly marked, until its owner validates it.
# The alias is the single source of truth for the value domain: the ORM column,
# the Read schemas, and (via the OpenAPI spec) the generated frontend type all
# derive from it, so adding a state is a one-line change here.
GeolocationState = Literal["validated", "detected"]
STATE_VALIDATED: GeolocationState = "validated"
STATE_DETECTED: GeolocationState = "detected"

# Field-length ceilings for the create / edit multipart forms, kept next to the
# columns so a Form(...) ``max_length`` can't drift from them. ``TITLE`` is the
# ``title`` column width (used in ``String(...)`` below); ``SOURCE_URL`` is an
# input ceiling only — the column is unbounded ``Text``, but the API caps
# accepted input so over-length data is rejected at the boundary.
TITLE_MAX_LENGTH = 255
SOURCE_URL_MAX_LENGTH = 2000


class Geolocation(Base):
    __tablename__ = "geolocations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    location = mapped_column(Geometry("POINT", srid=4326), nullable=False, index=True)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    # NOT NULL: every row carries a proof document. Human submits supply the
    # analyst's write-up; machine detections supply the tweet / thread text. The
    # empty-doc default catches ORM constructions that omit proof (seed, bounty
    # promote) — the create flow and machine path pass a real doc. Inline rather
    # than importing ``EMPTY_TIPTAP_DOC`` (models must not depend on services).
    proof = mapped_column(JSONB, nullable=False, default=lambda: {"type": "doc", "content": []})
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Optional time-of-day for ``event_date``, in UTC. NULL when the hour is
    # unknown — common, since the event date is often inferred from context or
    # from footage with no timestamp. A real-world event differs from a post:
    # its date may be known only to the day (contrast ``source_posted_at``).
    event_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    # When the original source (a Telegram channel, an X account, …) posted the
    # media — a real post instant, hence a full UTC timestamp and NOT NULL: a
    # post always has a time. Distinct from ``event_date`` (when the event
    # happened), ``detected_post_at`` (when the analyst posted the geolocation),
    # and ``created_at`` (submission to Vidit). On the machine path it equals the
    # imported tweet's timestamp (``source_url`` is the tweet there).
    source_posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # When the analyst published THIS geolocation on X — the post time of
    # ``detected_from_url``. The authorship / precedence signal for "who
    # geolocated this first", consumed by the v0.5 claim/dispute pipeline;
    # captured now because the originating tweet may be deleted before then.
    # NULL for human submits (no X import).
    detected_post_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Lifecycle state — ``validated`` (default) vs ``detected`` (machine path).
    # See ``STATE_*``. server_default so every non-machine insert stays correct
    # without setting it; the machine path passes ``state=STATE_DETECTED``.
    state: Mapped[GeolocationState] = mapped_column(
        String(20), nullable=False, default=STATE_VALIDATED, server_default=text("'validated'")
    )
    # The post a machine detection was imported from — the assemble idempotency
    # anchor and a provenance link, distinct from ``source_url`` (footage origin).
    # NULL for human submits.
    detected_from_url: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    # Soft-delete: NULL = live, timestamp = removed from public view. Filtered
    # out by every public read; only the admin path acts on soft-deleted rows.
    # Hard-delete (the GDPR escape hatch) drops the row + its media + S3 objects.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TRUE iff created by the admin "Demo data" seeder. Surfaced as a "DEMO"
    # badge; dropped en masse by the wipe button. Real submissions never set this.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Provenance trace when a geolocation was promoted from a bounty. The
    # bounty's status flips to ``fulfilled`` in the same transaction; the
    # reverse lookup (bounty → geolocation) goes through this column.
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
        # ``WHERE ... IS NOT NULL`` so standalone geolocations (the common case)
        # don't all collide on NULL. Mirrors migration
        # ``n0i2d4e6f8a0_bounty_unique_fulfillment``.
        Index(
            "uq_geolocations_originated_from_bounty_id",
            "originated_from_bounty_id",
            unique=True,
            postgresql_where="originated_from_bounty_id IS NOT NULL",
        ),
        # Backs the assemble idempotency look-up (one per detection during a
        # backfill). Partial on the populated cohort — human rows are always
        # NULL. Mirrors migration ``v8q0s2u4w6y8``.
        Index(
            "ix_geolocations_detected_from_url",
            "detected_from_url",
            postgresql_where="detected_from_url IS NOT NULL",
        ),
    )
