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
    ``sources`` row with ``site_id`` set), and every read derives the zone, the last image and
    the corroboration (``services/sites``). ``name`` and ``kind`` are versioned in
    ``site_versions``. ``owner_id`` cascades like ``Collection.owner_id``.
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
    """One superseded state of a site's record, filed by the owner's edit.

    Append-only, like ``EventVersion``: ``version_no`` is the version this row holds, and the
    live row is ``sites.version_no``.
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
    # ``{"name": ..., "kind": ...}`` as they stood before the edit.
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

    Append-only. The zone valid on a date is the contour whose image has the latest
    ``captured_at`` on or before it (``services/sites.zones_at``).
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

    author = relationship("User")

    __table_args__ = (
        Index("ix_site_contours_site_id", "site_id"),
        Index("ix_site_contours_source_id", "source_id"),
    )


class EventSiteLink(Base):
    """One period during which an event was linked to a site, with what it showed there.

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
