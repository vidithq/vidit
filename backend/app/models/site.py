import uuid
from datetime import UTC, datetime
from typing import Literal

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check
from app.models.event import TITLE_MAX_LENGTH

# Value domains (source of truth: the ORM CHECKs, the schemas and the generated frontend types
# derive from them). The migration that creates each CHECK changes by hand with its type.
SiteKind = Literal[
    "airbase",
    "military_base",
    "depot",
    "port",
    "air_defence_position",
    "artillery_position",
    "radar",
    "fortification",
    "unknown",
    "other",
]
# What a linked event shows at the site. ``activity`` is the neutral effect: activity observed,
# such as a column leaving or a launch.
LinkEffect = Literal["damage", "destruction", "activity", "other"]


class Site(Base):
    """A named area of interest that analysts monitor through dated satellite imagery.

    The zone is not a column: each contour is a ``site_contours`` row citing a site image (a
    ``sources`` row with ``site_id`` set), and every read derives the zone and the last image
    (``services/sites``). The live state is this row, the images not removed and their live
    contours; each write that changes it files the state it supersedes in ``site_versions``.
    ``owner_id`` cascades like ``Collection.owner_id``.
    """

    __tablename__ = "sites"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    kind: Mapped[SiteKind] = mapped_column(String(30), nullable=False)
    version_no: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )
    # Takedown: NULL = visible; same axis and reversal as ``Collection.hidden_at``.
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
        literal_check("kind", SiteKind, "ck_sites_kind_valid"),
        Index("ix_sites_owner_id", "owner_id"),
    )


class SiteVersion(Base):
    """One superseded state of a site, filed by the write that replaced it.

    Append-only, like ``EventVersion``: ``version_no`` is the version this row holds, and the
    live state is ``sites.version_no``. The snapshot names its images and contours by id, and
    neither row is ever deleted while the site stands: a removed image keeps its row with
    ``removed_at`` set, and a replaced contour keeps its row with ``superseded_at`` set.
    """

    __tablename__ = "site_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # ``schemas/site.SiteSnapshot``: the name, the kind, and each image with its contour.
    snapshot = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    edited_by = relationship("User")

    __table_args__ = (UniqueConstraint("site_id", "version_no", name="uq_site_versions_site_no"),)


class SiteContour(Base):
    """One zone the site's owner drew, citing the site image that shows it.

    Never edited: a redraw stamps ``superseded_at`` on the live row and inserts a new one. A live
    image carries at most one live contour (``uq_site_contours_live_source``). The zone valid on
    a date is the live contour whose image has the latest ``captured_at`` on or before it
    (``services/sites.zones_at``).
    """

    __tablename__ = "site_contours"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=False
    )
    # A ``sources`` row of the same site (checked in ``services/sites``).
    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    zone = mapped_column(Geometry("POLYGON", srid=4326, spatial_index=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # NULL while the contour is in the live state; set by the write that redrew or dropped it.
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    author = relationship("User")

    __table_args__ = (
        Index("ix_site_contours_site_id", "site_id"),
        Index("ix_site_contours_source_id", "source_id"),
        Index(
            "uq_site_contours_live_source",
            "source_id",
            unique=True,
            postgresql_where=text("superseded_at IS NULL"),
        ),
    )


class EventSiteLink(Base):
    """One event linked to a site, with what it shows there.

    Live state only, with no history: an effect change rewrites ``effect`` and an unlink deletes
    the row (``services/sites``). One row per event and site.
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

    event = relationship("Event")

    __table_args__ = (
        literal_check("effect", LinkEffect, "ck_event_site_links_effect_valid"),
        UniqueConstraint("event_id", "site_id", name="uq_event_site_links_event_site"),
        Index("ix_event_site_links_site_id", "site_id"),
    )
