import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from geoalchemy2 import Geometry
from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, UpdatedAt, literal_check
from app.models.event import TITLE_MAX_LENGTH

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
LinkEffect = Literal["damage", "destruction", "activity", "other"]


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH))
    kind: Mapped[SiteKind] = mapped_column(String(30))
    version_no: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    hidden_at: Mapped[datetime | None]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    owner = relationship("User")

    __table_args__ = (
        literal_check("kind", SiteKind, "ck_sites_kind_valid"),
        Index("ix_sites_owner_id", "owner_id"),
    )


class SiteVersion(Base):
    __tablename__ = "site_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    version_no: Mapped[int] = mapped_column(Integer)
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    note: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[CreatedAt]

    edited_by = relationship("User")

    __table_args__ = (UniqueConstraint("site_id", "version_no", name="uq_site_versions_site_no"),)


class SiteContour(Base):
    __tablename__ = "site_contours"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"))
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    zone = mapped_column(Geometry("POLYGON", srid=4326, spatial_index=True), nullable=False)
    created_at: Mapped[CreatedAt]
    superseded_at: Mapped[datetime | None]

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
    __tablename__ = "event_site_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    effect: Mapped[LinkEffect] = mapped_column(String(20))
    linked_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC), server_default=func.now()
    )

    event = relationship("Event")

    __table_args__ = (
        literal_check("effect", LinkEffect, "ck_event_site_links_effect_valid"),
        UniqueConstraint("event_id", "site_id", name="uq_event_site_links_event_site"),
        Index("ix_event_site_links_site_id", "site_id"),
    )
