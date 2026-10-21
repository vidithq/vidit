import uuid
from datetime import UTC, date, datetime
from typing import Literal

from geoalchemy2 import Geometry
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check
from app.models.event import TITLE_MAX_LENGTH

# Value domains (source of truth: the ORM CHECKs, the schemas and the generated
# frontend types derive from them). The migration that creates each CHECK
# changes by hand with its type.
SiteType = Literal[
    "airbase",
    "military_base",
    "depot",
    "port",
    "air_defence_position",
    "artillery_position",
    "radar",
    "fortification",
    "other",
]
ImageryProvider = Literal["google_earth", "sentinel_2", "landsat", "other"]
# What the imagery shows, never an intention.
ObservationEffect = Literal[
    "observed_no_change",
    "construction_extension",
    "no_visible_activity",
    "reoccupation",
    "other",
]
LinkEffect = Literal["damage", "destruction", "other"]

OBSERVATION_EFFECT_DEFAULT: ObservationEffect = "observed_no_change"


class Site(Base):
    """A durable place (a base, a depot, a radar) with a name and a type.

    The zone is not a column: it lives on :class:`SiteObservation`, one dated
    polygon per observation, and every read derives the zone, the state and
    the corroboration from those rows and from ``event_site_links``
    (``services/sites``). ``owner_id`` cascades like ``Collection.owner_id``.
    """

    __tablename__ = "sites"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    site_type: Mapped[SiteType] = mapped_column(String(30), nullable=False)
    # Takedown: NULL = visible; same axis and reversal as ``Event.hidden_at``.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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

    owner = relationship("User")

    __table_args__ = (
        literal_check("site_type", SiteType, "ck_sites_site_type_valid"),
        Index("ix_sites_owner_id", "owner_id"),
    )


class SiteObservation(Base):
    """One dated zone of a site, proven by imagery captured on ``captured_on``.

    Append-only: a correction is a new row. The zone valid on a date is the row
    with the greatest ``(captured_on, created_at)`` at or before it.
    """

    __tablename__ = "site_observations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    zone = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    captured_on: Mapped[date] = mapped_column(Date, nullable=False)
    imagery_provider: Mapped[ImageryProvider] = mapped_column(String(20), nullable=False)
    imagery_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    effect: Mapped[ObservationEffect] = mapped_column(
        String(30), nullable=False, default=OBSERVATION_EFFECT_DEFAULT
    )
    # Plain text; the API caps it at ``schemas/site.NOTE_MAX_LENGTH``.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    author = relationship("User")

    __table_args__ = (
        literal_check(
            "imagery_provider", ImageryProvider, "ck_site_observations_imagery_provider_valid"
        ),
        literal_check("effect", ObservationEffect, "ck_site_observations_effect_valid"),
        # A provider outside the list is reproducible only through its URL.
        CheckConstraint(
            "imagery_provider <> 'other' OR imagery_url IS NOT NULL",
            name="ck_site_observations_other_needs_url",
        ),
        Index(
            "ix_site_observations_site_captured",
            "site_id",
            "captured_on",
            "created_at",
        ),
    )


class EventSiteLink(Base):
    """One period during which an event was linked to a site, with what it did to the site.

    Append-only history: unlinking stamps ``unlinked_at``, and changing the effect stamps
    ``unlinked_at`` on the live row and inserts a new one with ``linked_at`` equal to it, in one
    transaction (``services/sites.link_event``). The partial unique index allows one live row
    per event and site. ``linked_by_id`` and ``unlinked_by_id`` record the event owner at the
    time, since ownership can move.
    """

    __tablename__ = "event_site_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    effect: Mapped[LinkEffect] = mapped_column(String(20), nullable=False)
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    linked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unlinked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    event = relationship("Event")
    linked_by = relationship("User", foreign_keys=[linked_by_id])
    unlinked_by = relationship("User", foreign_keys=[unlinked_by_id])

    __table_args__ = (
        literal_check("effect", LinkEffect, "ck_event_site_links_effect_valid"),
        Index(
            "uq_event_site_links_live",
            "event_id",
            "site_id",
            unique=True,
            postgresql_where=text("unlinked_at IS NULL"),
        ),
        Index("ix_event_site_links_site_id", "site_id"),
        Index("ix_event_site_links_event_id", "event_id"),
    )
