import uuid
from datetime import UTC, date, datetime, time
from typing import Literal

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ColumnElement,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    and_,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Lifecycle status (value-domain source of truth: the ORM column, the Read
# schemas and the generated frontend type derive from it).
#   ``requested``   an open call to geolocate; may carry an approximate guess.
#   ``detected``    a machine detection, public but marked; may carry no location.
#   ``geolocated``  a person vouched for it; always has a location.
#   ``closed``      withdrawn (requested), rejected (detected) or retracted
#                   (geolocated, still publicly readable with its history);
#                   ``before_closed_status`` records which.
# ``event_coords`` is independent of ``status`` except that ``geolocated``
# requires it (``ck_events_coords_status``).
EventStatus = Literal["requested", "detected", "geolocated", "closed"]
STATUS_REQUESTED: EventStatus = "requested"
STATUS_DETECTED: EventStatus = "detected"
STATUS_GEOLOCATED: EventStatus = "geolocated"
STATUS_CLOSED: EventStatus = "closed"

# The status held just before ``closed`` (withdrawn / rejected / retracted).
# A closed detection stays in the located catalog; a retraction leaves every
# feed and the map (``services/event_filters.view_predicate``).
BeforeClosedStatus = Literal["requested", "detected", "geolocated"]

# Which ingest entry produced a machine detection. Stamped once by
# ``detection.persist_detections``; NULL on human submits and older rows. Pinned
# by ``ck_events_detected_via_valid``; keep the two in step.
DetectedVia = Literal["bot", "paste", "archive"]

# Field-length ceilings for the create / edit forms. ``SOURCE_URL`` is an input
# cap only: the column is unbounded ``Text``.
TITLE_MAX_LENGTH = 255
SOURCE_URL_MAX_LENGTH = 2000
# Ceiling on ``event_source_links`` rows per event; a submission past it is
# rejected, not truncated.
MAX_SECONDARY_SOURCE_LINKS = 10


class EventGeolocator(Base):
    """Durable credit for the geolocation: who vouched the location.

    Written at the ``geolocate`` transition (at least one row). The owner is
    always among these rows, so a user erasure cannot leave a ``geolocated``
    event below one geolocator. The composite PK makes credit idempotent.
    """

    __tablename__ = "event_geolocators"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    event = relationship("Event", back_populates="geolocators")
    user = relationship("User")

    __table_args__ = (
        # Serves the "a user's geolocations" profile query.
        Index("ix_event_geolocators_user_created_at", "user_id", "created_at"),
    )


class EventVersion(Base):
    """One superseded version of a published event, snapshotted at an edit.

    Append-only: ``services/events.save_version`` writes a row before the edit
    lands. ``version_no`` is the version this row holds, so an event at version
    3 carries snapshots 1 and 2 plus the live row.

    ``snapshot`` holds the fields the edit form writes
    (``services/versions.build_snapshot``). Media rows are not versioned, so a
    ``proof`` row a snapshot points at is never hard-deleted while the snapshot
    exists (``services/versions.referenced_media_urls``). The ``source`` row
    cannot stay (one per event), so the snapshot describes it and its file
    outlives the row (``services/versions.referenced_source_media``).

    Redaction is the one write a filed row takes: an admin blanks ``snapshot``
    and ``note`` and stamps ``redacted_at`` / ``redacted_by_id``. The row and
    its number stay so ``/vN`` addressing never shifts.
    """

    __tablename__ = "event_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # SET NULL: an event outlives a non-owner editor, and a GDPR erasure nulls
    # the attribution instead of failing on the FK.
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Unbounded ``Text``; the API caps input at ``schemas/event.VERSION_NOTE_MAX_LENGTH``.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # NULL on every ordinary row (moderation exit for a version the record must
    # not keep serving).
    redacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SET NULL for the same reason as ``edited_by_id``.
    redacted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    event = relationship("Event", back_populates="versions")
    # Only the editor is a relationship: the redacting admin is audited in
    # ``admin_events`` and never rendered.
    edited_by = relationship("User", foreign_keys=[edited_by_id])

    __table_args__ = (
        # The append-only writer takes the number off the locked event row, so a
        # duplicate is a bug the database rejects. The leading ``event_id`` also
        # serves the history read.
        UniqueConstraint("event_id", "version_no", name="uq_event_versions_event_no"),
    )


class EventSourceLink(Base):
    """One secondary source link: the same media mirrored on another network,
    or another post from the same point of view.

    The primary anchor stays the scalar ``Event.source_url``. These extras are
    replaced wholesale by the geolocate transition and every later correction,
    while the anchor moves only on its own field (and files a version).
    ``position`` is part of the PK, so stored order is read order.
    """

    __tablename__ = "event_source_links"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Unbounded ``Text``; the API caps input at ``SOURCE_URL_MAX_LENGTH``.
    url: Mapped[str] = mapped_column(Text, nullable=False)

    event = relationship("Event", back_populates="source_links")


class Event(Base):
    """One event across the merged request + geolocation lifecycle.

    ``status`` (``EventStatus``) is the lifecycle; ``event_coords`` is an
    independent nullable axis required only at ``geolocated``
    (``ck_events_coords_status``). Fulfilling a request updates this row and
    inserts an ``event_geolocators`` row, with no copy.
    """

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Edit-rights owner. A ``requested`` event's poster, handed to the fulfiller
    # at geolocate. Always among the geolocators once ``geolocated``.
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Who opened the request, kept across fulfilment. NULL for a direct
    # geolocation. SET NULL: the event outlives its requester and a GDPR erasure
    # nulls the attribution instead of failing on the FK.
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    # What the footage shows. Required at ``geolocated`` (``ck_events_coords_status``).
    # One point per event.
    event_coords = mapped_column(Geometry("POINT", srid=4326), nullable=True, index=True)
    # Where the footage was shot from. Unindexed: no spatial read uses it.
    capture_source_coords = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False), nullable=True
    )
    # The declared footage source. A detection may carry none; the other states
    # require it (``ck_events_source_url_status``, ``services/events.geolocate``).
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The empty-doc default catches ORM constructions that omit proof. Inlined
    # because the models layer must not import from services.
    proof = mapped_column(JSONB, nullable=False, default=lambda: {"type": "doc", "content": []})
    # Often unknown for a ``requested`` event; required at ``geolocated``.
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # UTC time of day. May stand alone: an hour can be known before the day.
    event_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    # When the original source posted the media (UTC instant). Distinct from
    # ``event_date`` and ``created_at``. NULL unless actually known.
    source_posted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When the analyst published THIS geolocation on X (post time of
    # ``detected_from_url``): the precedence signal for the claim/dispute
    # pipeline. NULL for human submits.
    detected_post_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Per-state entry stamps, set on entry and never cleared; the
    # ``geolocated`` / ``closed`` ones are tied to ``status`` by CHECKs.
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    detected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    geolocated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # See ``STATUS_*``. server_default keeps a human submit correct without
    # setting it; the requested / detected paths pass it explicitly.
    status: Mapped[EventStatus] = mapped_column(
        String(20), nullable=False, default=STATUS_GEOLOCATED, server_default=text("'geolocated'")
    )
    # The post a machine detection was imported from (``source_url`` is the
    # footage origin). The id is the re-import match anchor; the URL is built
    # from it (``tweet_ingest.urls.canonical_tweet_url``). NULL for human submits.
    detected_from_tweet_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    detected_from_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Every post id of the thread the detection was read from, anchor included.
    # The re-import match reads it so the three entries land on one row: an
    # archive anchors on the thread head, a bot tag or paste on a later post,
    # so matching the anchor alone would file one geolocation as two detections.
    # Written once at creation. NULL for human submits; older rows carry their
    # anchor id alone.
    detected_thread_tweet_ids: Mapped[list[int] | None] = mapped_column(
        ARRAY(BigInteger), nullable=True
    )
    # Which entry produced this detection (``DetectedVia``). Written once, never
    # moved by a re-import. NULL for human submits and older rows.
    detected_via: Mapped[DetectedVia | None] = mapped_column(String(20), nullable=True)

    @hybrid_property
    def is_machine_detection(self) -> bool:
        """Whether this row is a machine extraction the pipeline is judged on.

        An imported row carries ``detected_from_url`` and a request carries
        ``requested_at`` for life, so the pair separates a detection from a
        request the bot opened (which carries both). Read by
        ``services/admin.detection_quality_stats``. The
        ``ix_events_detected_from_url`` index backs the first leg alone.
        """
        return self.detected_from_url is not None and self.requested_at is None

    @is_machine_detection.inplace.expression
    @classmethod
    def _is_machine_detection_expression(cls) -> ColumnElement[bool]:
        return and_(cls.detected_from_url.isnot(None), cls.requested_at.is_(None))

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
    # Set when the event reaches ``closed``.
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Free-text reason shown for transparency.
    close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # See ``BeforeClosedStatus``; non-NULL exactly when ``status='closed'``.
    before_closed_status: Mapped[BeforeClosedStatus | None] = mapped_column(
        String(20), nullable=True
    )
    # Soft-delete: NULL = live. Filtered out by every public read.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Takedown after a content report: withheld from public reads alongside
    # ``deleted_at``, but reversible by an admin.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TRUE when the footage shows death, injury or human remains. Set by the
    # author, overridable by an admin. Read surfaces cover flagged imagery until
    # the viewer opts in, so the column is public.
    is_graphic: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default=text("false")
    )
    # Which version this row IS. Incremented under the row lock by
    # ``services/events.save_version``, which first files the superseded state as
    # an ``EventVersion``. A public address (``/events/{id}/v{n}``), so it only
    # moves forward.
    version_no: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )

    owner = relationship("User", foreign_keys=[owner_id], back_populates="events")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    media = relationship("Media", back_populates="event", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary="event_tags", back_populates="events")
    conflicts = relationship("Conflict", secondary="event_conflicts", back_populates="events")
    geolocators = relationship(
        "EventGeolocator",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventGeolocator.created_at",
    )
    # Links the owner recorded an archived copy for (``models.source_archive``).
    archives = relationship(
        "SourceArchive",
        back_populates="event",
        cascade="all, delete-orphan",
    )
    source_links = relationship(
        "EventSourceLink",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventSourceLink.position",
    )
    # Superseded versions, oldest first (``EventVersion``).
    versions = relationship(
        "EventVersion",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventVersion.version_no",
    )

    __table_args__ = (
        # Geolocated needs a subject coordinate.
        CheckConstraint(
            "status <> 'geolocated' OR event_coords IS NOT NULL",
            name="ck_events_coords_status",
        ),
        # Requested and geolocated rows need a source URL.
        CheckConstraint(
            "status NOT IN ('requested', 'geolocated') OR source_url IS NOT NULL",
            name="ck_events_source_url_status",
        ),
        # Stamps tied to status so a path that forgets one is rejected.
        CheckConstraint(
            "status <> 'closed' OR closed_at IS NOT NULL",
            name="ck_events_closed_stamp",
        ),
        CheckConstraint(
            "status <> 'geolocated' OR geolocated_at IS NOT NULL",
            name="ck_events_geolocated_stamp",
        ),
        # ``before_closed_status`` is set exactly when ``closed`` and in-domain.
        # Mirror of ``BeforeClosedStatus``; keep the two in step.
        CheckConstraint(
            # ``IS NOT NULL`` is load-bearing: ``NULL IN (...)`` is unknown, and
            # Postgres accepts any CHECK that is not FALSE.
            "(status = 'closed' AND before_closed_status IS NOT NULL"
            " AND before_closed_status IN ('requested', 'detected', 'geolocated'))"
            " OR (status <> 'closed' AND before_closed_status IS NULL)",
            name="ck_events_before_closed_status",
        ),
        # Pin the ``status`` domain at the DB. Mirror of ``EventStatus``; keep
        # the two in step.
        CheckConstraint(
            "status IN ('requested', 'detected', 'geolocated', 'closed')",
            name="ck_events_status_valid",
        ),
        # Same for ``DetectedVia``; NULL is in-domain. Keep the two in step.
        CheckConstraint(
            "detected_via IS NULL OR detected_via IN ('bot', 'paste', 'archive')",
            name="ck_events_detected_via_valid",
        ),
        # Open requests / detections / geolocations, newest first.
        Index("ix_events_status_created_at", "status", "created_at"),
        # Backs the re-import match on an owner's rows by source post. Partial:
        # human rows are NULL.
        Index(
            "ix_events_owner_detected_from_tweet_id",
            "owner_id",
            "detected_from_tweet_id",
            postgresql_where=text("detected_from_tweet_id IS NOT NULL"),
        ),
        # Backs the thread-overlap leg of the same match (GIN array overlap).
        Index(
            "ix_events_detected_thread_tweet_ids",
            "detected_thread_tweet_ids",
            postgresql_using="gin",
            postgresql_where=text("detected_thread_tweet_ids IS NOT NULL"),
        ),
        # Backs the admin machine-detection cohort scans.
        Index(
            "ix_events_detected_from_url",
            "detected_from_url",
            postgresql_where=text("detected_from_url IS NOT NULL"),
        ),
        # Serves the profile read and the admin GDPR delete's owned-event
        # enumeration. ``ix_events_owner_id`` is redundant with the composite
        # (cleanup tracked in issue #476).
        Index("ix_events_owner_id", "owner_id"),
        Index("ix_events_owner_created", "owner_id", "created_at"),
        # Backs the keyset of the capped list endpoints (``created_at DESC, id
        # DESC``, ``services/pagination.keyset_before``).
        Index("ix_events_created_at_id", "created_at", "id"),
    )
