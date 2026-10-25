import uuid
from datetime import UTC, datetime
from typing import Literal, get_args

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Table,
    Text,
    UniqueConstraint,
    case,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check

# Evidence level of a source: how close it stands to the act (``docs/data-model.md``).
# ``direct`` shows the act while it happens, ``indirect`` its direct consequences after the
# fact, ``context`` anything else. Value-domain source of truth for the column, the schemas and
# the generated frontend type.
SourceLevel = Literal["direct", "indirect", "context"]
# The levels that support a publication (``services/events/sources.check_publish_floor``).
# Mirrored by ``frontend/src/lib/sources.ts::isEvidenceLevel``; change both.
EVIDENCE_LEVELS: tuple[SourceLevel, ...] = ("direct", "indirect")

# Where a source comes from: what captured it (``camera`` is a handheld or press camera,
# ``static_camera`` a CCTV or webcam, ``aircraft`` a plane or helicopter, historical aerial
# photos included) or the kind of document it is. Whether its file is a photo
# or a video is the file's own ``media.kind``. Closed list; value-domain source of truth for the
# column, the schemas, the ``source_kind`` filter and the generated frontend type. ``unknown``
# keeps the choice satisfiable for a source of uncertain provenance.
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

# Which service holds a link's archived copy, derived from the snapshot URL's host
# (``services/source_archive.PROVIDER_HOSTS``); never stored.
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
    # Backs the tag deletion cascade and the live-tags read.
    Index("ix_source_tags_tag_id", "tag_id"),
)


class Source(Base):
    """One piece of evidence: a file and the URLs it was posted at.

    Its owner is an event (the evidence the event rests on) or a site (a dated satellite image
    in its imagery history), never both (``ck_sources_one_owner``). An event holds up to
    :data:`MAX_SOURCES_PER_EVENT` sources and none is the main one. The order is derived
    (:func:`source_order`). An event's source is versioned with its event
    (``services/versions.build_snapshot``): an edit to it is an edit to the event. A site's
    source is never edited.
    """

    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # A site image's analyst; any signed-in analyst files one. NULL on an event's source.
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # A site image's plain-text note; the API caps it at ``schemas/site.IMAGE_NOTE_MAX_LENGTH``.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ``""`` is no title.
    title: Mapped[str] = mapped_column(
        String(SOURCE_TITLE_MAX_LENGTH), nullable=False, default="", server_default=text("''")
    )
    level: Mapped[SourceLevel] = mapped_column(String(10), nullable=False)
    # A machine source is ``unknown`` until a review names it.
    kind: Mapped[SourceKind] = mapped_column(String(20), nullable=False)
    # When the media was captured (UTC). Distinct from the event's ``occurred_date`` and a
    # link's ``posted_at``.
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Where a capture was shot from. Unindexed: no spatial read uses it.
    capture_position = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False), nullable=True
    )
    # TRUE when the media shows death, injury or human remains. Read surfaces cover it until
    # the viewer opts in; an event is graphic when any of its sources is (``Event.is_graphic``).
    is_graphic: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

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
    tags = relationship("Tag", secondary=source_tags, back_populates="sources")
    # One file per source (``uq_media_source_id``); None for a URL-only source.
    media = relationship(
        "Media", uselist=False, back_populates="source", cascade="all, delete-orphan"
    )

    __table_args__ = (
        literal_check("level", SourceLevel, "ck_sources_level_valid"),
        literal_check("kind", SourceKind, "ck_sources_kind_valid"),
        CheckConstraint("num_nonnulls(event_id, site_id) = 1", name="ck_sources_one_owner"),
        # A site image is a dated satellite capture that supports no publication.
        CheckConstraint(
            "site_id IS NULL OR (kind = 'satellite' AND level = 'context' "
            "AND captured_at IS NOT NULL)",
            name="ck_sources_site_image",
        ),
        CheckConstraint(
            "site_id IS NOT NULL OR (author_id IS NULL AND note IS NULL)",
            name="ck_sources_site_fields",
        ),
    )


class SourceLink(Base):
    """One URL a source's media was posted at, with its archived copy."""

    __tablename__ = "source_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    # When the media was posted at this URL (UTC). NULL unless known.
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The archived copy the analyst recorded (``services/source_archive.validate_snapshot``).
    snapshot_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When that copy was recorded; set exactly with ``snapshot_url``.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    source = relationship("Source", back_populates="links")

    __table_args__ = (
        # The leading ``source_id`` also backs the per-source read.
        UniqueConstraint("source_id", "url", name="uq_source_links_source_url"),
        CheckConstraint(
            "(snapshot_url IS NULL) = (archived_at IS NULL)",
            name="ck_source_links_archive_stamp",
        ),
    )


def level_rank():
    """``direct`` first, then ``indirect``, then ``context``: the leading sort key of
    :func:`source_order`."""
    return case({"direct": 0, "indirect": 1}, value=Source.level, else_=2)


def source_order():
    """The derived order of an event's sources: level, then capture time (unknown last)."""
    return (
        level_rank(),
        Source.captured_at.asc().nulls_last(),
        Source.created_at,
        Source.id,
    )
