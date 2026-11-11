import uuid
from datetime import datetime
from typing import Literal, get_args

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, UpdatedAt, literal_check

SourceLevel = Literal["direct", "indirect", "context"]
# The levels that support a publication (``services/events/sources.check_publish_floor``).
# Mirrored by ``frontend/src/lib/sources.ts::isEvidenceLevel``; change both.
EVIDENCE_LEVELS: tuple[SourceLevel, ...] = ("direct", "indirect")

SourceKind = Literal[
    "smartphone",
    "camera",
    "static_camera",
    "drone",
    "aircraft",
    "satellite",
    "dashcam",
    "body_cam",
    "article",
    "official_statement",
    "other",
    "unknown",
]
SOURCE_KINDS: tuple[SourceKind, ...] = get_args(SourceKind)
# The kinds that are documents, not captures: a document carries no capture position, and a
# write drops one it posts (``schemas/source.SourceCreate``). Mirrored by
# ``frontend/src/lib/sources.ts::DOCUMENT_SOURCE_KINDS``; change both.
DOCUMENT_SOURCE_KINDS: frozenset[SourceKind] = frozenset({"article", "official_statement", "other"})

ArchiveProvider = Literal["wayback", "archive_today", "ghostarchive"]

# Ceilings per event and per source. A write past either is rejected, not truncated; an
# import truncates instead (no one to report to). Mirrored, with the two input caps below, in
# ``frontend/src/lib/sources.ts``; change both.
MAX_SOURCES_PER_EVENT = 10
MAX_LINKS_PER_SOURCE = 10
# Input caps: the columns are unbounded ``Text``.
SOURCE_URL_MAX_LENGTH = 2000
SOURCE_TITLE_MAX_LENGTH = 255

source_tags = Table(
    "source_tags",
    Base.metadata,
    Column("source_id", ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_source_tags_tag_id", "tag_id"),
)


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    removed_at: Mapped[datetime | None]
    title: Mapped[str] = mapped_column(
        String(SOURCE_TITLE_MAX_LENGTH), default="", server_default=text("''")
    )
    level: Mapped[SourceLevel] = mapped_column(String(10))
    position: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=text("0"))
    kind: Mapped[SourceKind] = mapped_column(String(20))
    captured_at: Mapped[datetime | None]
    capture_position = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False), nullable=True
    )
    is_graphic: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    event = relationship("Event", back_populates="sources")
    author = relationship("User")
    links = relationship(
        "SourceLink",
        back_populates="source",
        cascade="all, delete-orphan",
        order_by=lambda: (
            SourceLink.posted_at.asc().nulls_last(),
            SourceLink.created_at,
            SourceLink.id,
        ),
    )
    tags = relationship("Tag", secondary=source_tags, back_populates="sources", order_by="Tag.name")
    media = relationship(
        "Media", uselist=False, back_populates="source", cascade="all, delete-orphan"
    )

    __table_args__ = (
        literal_check("level", SourceLevel, "ck_sources_level_valid"),
        literal_check("kind", SourceKind, "ck_sources_kind_valid"),
        CheckConstraint("num_nonnulls(event_id, site_id) = 1", name="ck_sources_one_owner"),
        CheckConstraint(
            "site_id IS NULL OR (kind = 'satellite' AND level = 'context' "
            "AND captured_at IS NOT NULL)",
            name="ck_sources_site_capture",
        ),
        CheckConstraint(
            "site_id IS NOT NULL OR (author_id IS NULL AND note IS NULL AND removed_at IS NULL)",
            name="ck_sources_site_fields",
        ),
        Index("ix_sources_author_id", "author_id", postgresql_where=text("author_id IS NOT NULL")),
    )


class SourceLink(Base):
    __tablename__ = "source_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    posted_at: Mapped[datetime | None]
    snapshot_url: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None]
    created_at: Mapped[CreatedAt]

    source = relationship("Source", back_populates="links")

    __table_args__ = (
        UniqueConstraint("source_id", "url", name="uq_source_links_source_url"),
        CheckConstraint(
            "(snapshot_url IS NULL) = (archived_at IS NULL)",
            name="ck_source_links_archive_stamp",
        ),
    )


def source_order():
    return (Source.position, Source.created_at, Source.id)
