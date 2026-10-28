import uuid
from datetime import UTC, date, datetime, time
from typing import Literal

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
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
    case,
    exists,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.engine.default import DefaultExecutionContext
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check
from app.models.source import Source, source_order

# Lifecycle status (value-domain source of truth: the ORM column, the Read
# schemas and the generated frontend type derive from it).
#   ``requested``   an open call to geolocate; may carry an approximate guess.
#   ``detected``    a machine detection, public but marked; may carry no location.
#   ``geolocated``  a person vouched for it; always has a location.
#   ``closed``      withdrawn (requested), rejected (detected) or retracted
#                   (geolocated, still publicly readable with its history);
#                   ``before_closed_status`` records which.
# ``coords`` is independent of ``status`` except that ``geolocated``
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

# What version 0 of an event is: the request or the detection it was published from, or the
# open row itself (``services/versions.version_zero``).
VersionZero = Literal["request", "detection"]

# Which ingest entry produced a machine detection. Stamped once by
# ``detection.persist_detections``; NULL on older rows. Pinned by
# ``ck_event_detections_via_valid``.
DetectedVia = Literal["bot", "paste", "archive"]


def _initial_version(context: DefaultExecutionContext) -> int:
    """0 for a row born unpublished (a request or a detection), else 1."""
    params = context.get_current_parameters()
    state = params.get("before_closed_status") or params.get("status")
    return 0 if state in (STATUS_REQUESTED, STATUS_DETECTED) else 1


# Field-length ceiling for the create / edit forms. Mirrored by
# ``frontend/src/lib/events.ts::EVENT_TITLE_MAX_LEN``; change both.
TITLE_MAX_LENGTH = 255


# Where an analyst stands on one event's credit. ``invited``: the owner asked
# them to share it. ``active``: they hold it. ``departed``: they held it and
# lost it (removed by the owner, or left). A departed analyst may be invited
# again: the row keeps ``departed_at``, declining returns it to ``departed``,
# accepting makes it ``active``.
GeolocatorState = Literal["invited", "active", "departed"]


class EventGeolocator(Base):
    """One analyst's standing on one event's geolocation credit, one row per pair.

    ``active`` rows are the credit: who vouched the location. The owner of a
    ``geolocated`` event always holds an ``active`` row, so an erasure hands a
    co-credited event to the earliest other geolocator rather than leaving it
    below one. A transition updates the row (``services/geolocator_credit``).
    A former geolocator is no more independent of the work than a current one,
    so neither approves the event nor is asked to approve it.
    """

    __tablename__ = "event_geolocators"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    state: Mapped[GeolocatorState] = mapped_column(String(20), nullable=False)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The first departure; a later one leaves it as it is.
    departed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event = relationship("Event", viewonly=True)
    user = relationship("User")

    __table_args__ = (
        literal_check("state", GeolocatorState, "ck_event_geolocators_state_valid"),
        CheckConstraint(
            "(state <> 'invited' OR invited_at IS NOT NULL)"
            " AND (state <> 'active' OR joined_at IS NOT NULL)"
            " AND (state <> 'departed' OR departed_at IS NOT NULL)",
            name="ck_event_geolocators_state_stamp",
        ),
        # Serves the "a user's geolocations" profile query.
        Index(
            "ix_event_geolocators_user_id_joined_at",
            "user_id",
            "joined_at",
            postgresql_where=text("state = 'active'"),
        ),
        # Backs the cascade of an erased analyst.
        Index("ix_event_geolocators_user_id", "user_id"),
    )


class EventVersion(Base):
    """One superseded version of an event, snapshotted at an edit.

    Append-only: ``services/versions.file_version`` writes a row before the edit
    lands. ``version_no`` is the version this row holds, so an event at version
    3 carries snapshots 1 and 2 plus the live row, and snapshot 0 too when it
    was published from a request or a detection.

    ``snapshot`` holds the fields the edit form writes, its sources included
    (``services/versions.build_snapshot``). Media rows are not versioned, so a
    ``proof`` row a snapshot points at is never hard-deleted while the snapshot
    exists (``services/versions.referenced_media_urls``). A source an edit drops
    goes with its row, so the snapshot describes it and its file outlives the row
    (``services/versions.referenced_source_media``).

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
    # ``audit_log`` and never rendered.
    edited_by = relationship("User", foreign_keys=[edited_by_id])

    __table_args__ = (
        # The append-only writer takes the number off the locked event row, so a
        # duplicate is a bug the database rejects. The leading ``event_id`` also
        # serves the history read.
        UniqueConstraint("event_id", "version_no", name="uq_event_versions_event_no"),
    )


class EventDetection(Base):
    """Where a machine-written event came from: the post it was imported from, its thread and
    the entry that read it. One row per imported event, written once at creation
    (``services/events/request.stamp_provenance``); only ``post_at`` follows a re-import.
    """

    __tablename__ = "event_detections"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    via: Mapped[DetectedVia | None] = mapped_column(String(20), nullable=True)
    # The post's URL, built from its id (``tweet_ingest.urls.canonical_tweet_url``). Not a
    # source: the event's sources are the footage it rests on.
    from_url: Mapped[str] = mapped_column(Text, nullable=False)
    # The re-import match anchor.
    from_post_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Every post id of the thread the detection was read from, anchor included.
    # The re-import match reads it so the three entries land on one row: an
    # archive anchors on the thread head, a bot tag or paste on a later post,
    # so matching the anchor alone would file one geolocation as two detections.
    # Older rows carry their anchor id alone.
    thread_post_ids: Mapped[list[int] | None] = mapped_column(ARRAY(BigInteger), nullable=True)
    # When the analyst published this geolocation on X: the precedence signal for the
    # claim/dispute pipeline.
    post_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event = relationship("Event", back_populates="detection")

    __table_args__ = (
        literal_check("via", DetectedVia, "ck_event_detections_via_valid", nullable=True),
        # Back the re-import match by anchor post and by thread overlap.
        Index(
            "ix_event_detections_from_post_id",
            "from_post_id",
            postgresql_where=text("from_post_id IS NOT NULL"),
        ),
        Index(
            "ix_event_detections_thread_post_ids",
            "thread_post_ids",
            postgresql_using="gin",
            postgresql_where=text("thread_post_ids IS NOT NULL"),
        ),
    )


class Event(Base):
    """One event across the merged request + geolocation lifecycle.

    ``status`` (``EventStatus``) is the lifecycle; ``coords`` is an
    independent nullable axis required only at ``geolocated``
    (``ck_events_coords_status``). Fulfilling a request updates this row and
    inserts an ``event_geolocators`` row, with no copy.
    """

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Edit-rights owner. A ``requested`` event's poster, handed to the fulfiller
    # at the publish. Always among the geolocators once ``geolocated``.
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
    coords = mapped_column(Geometry("POINT", srid=4326), nullable=True, index=True)
    # Sanitised HTML (``services/sanitize.sanitize_html``); ``""`` is an empty body.
    proof: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Often unknown for a ``requested`` event; required at ``geolocated``.
    occurred_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # UTC time of day. May stand alone: an hour can be known before the day.
    occurred_time: Mapped[time | None] = mapped_column(Time, nullable=True)
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

    @hybrid_property
    def is_machine_detection(self) -> bool:
        """Whether this row is a machine extraction the pipeline is judged on.

        An imported row carries an ``event_detections`` row and a request carries
        ``requested_at`` for life, so the pair separates a detection from a
        request the bot opened (which carries both). Read by
        ``services/admin.detection_quality_stats``.
        """
        return self.detection is not None and self.requested_at is None

    @is_machine_detection.inplace.expression
    @classmethod
    def _is_machine_detection_expression(cls) -> ColumnElement[bool]:
        return and_(exists().where(EventDetection.event_id == cls.id), cls.requested_at.is_(None))

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
    # Which version this row IS: 0 until the row is published, then 1 and up. Incremented
    # under the row lock by ``services/events.save_version``, which first files the
    # superseded state as an ``EventVersion``. A public address (``/events/{id}/v{n}``), so
    # it only moves forward. ``ck_events_version_published`` ties it to the status.
    version_no: Mapped[int] = mapped_column(
        Integer, nullable=False, default=_initial_version, server_default=text("1")
    )

    @hybrid_property
    def is_graphic(self) -> bool:
        """Whether any source shows death, injury or human remains (``Source.is_graphic``)."""
        return any(source.is_graphic for source in self.sources)

    @is_graphic.inplace.expression
    @classmethod
    def _is_graphic_expression(cls) -> ColumnElement[bool]:
        return exists().where(Source.event_id == cls.id, Source.is_graphic.is_(True))

    owner = relationship("User", foreign_keys=[owner_id], back_populates="events")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    # Proof-body images only; a source's file hangs off its source.
    media = relationship("Media", back_populates="event", cascade="all, delete-orphan")
    # In the order the author set (``models/source.source_order``).
    sources = relationship(
        "Source",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by=lambda: source_order(),
    )
    tags = relationship("Tag", secondary="event_tags", back_populates="events")
    conflicts = relationship("Conflict", secondary="event_conflicts", back_populates="events")
    # The credit: ``active`` rows only, earliest first.
    geolocators = relationship(
        "EventGeolocator",
        primaryjoin="and_(Event.id == EventGeolocator.event_id, EventGeolocator.state == 'active')",
        viewonly=True,
        order_by="EventGeolocator.joined_at",
    )
    # Where a machine-written row came from; None for a human submit.
    detection = relationship(
        "EventDetection", uselist=False, back_populates="event", cascade="all, delete-orphan"
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
            "status <> 'geolocated' OR coords IS NOT NULL",
            name="ck_events_coords_status",
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
        # Version 0 is the unpublished row (a request or a detection, open or closed); a
        # published row is version 1 and up.
        CheckConstraint(
            "(version_no = 0) = (COALESCE(before_closed_status, status)"
            " IN ('requested', 'detected'))",
            name="ck_events_version_published",
        ),
        literal_check("status", EventStatus, "ck_events_status_valid"),
        # Open requests / detections / geolocations, newest first.
        Index("ix_events_status_created_at", "status", "created_at"),
        # Serves the profile read and the admin GDPR delete's owned-event
        # enumeration. ``ix_events_owner_id`` is redundant with the composite
        # (cleanup tracked in issue #476).
        Index("ix_events_owner_id", "owner_id"),
        Index("ix_events_owner_created", "owner_id", "created_at"),
        # Backs the keyset of the capped list endpoints (``created_at DESC, id
        # DESC``, ``services/pagination.keyset_before``).
        Index("ix_events_created_at_id", "created_at", "id"),
    )


def feed_at() -> ColumnElement[datetime]:
    """When an event entered the feed: ``requested_at`` for an open request, ``detected_at`` for
    a detection, else ``geolocated_at``.

    Each stamp is set on entry and never cleared, so the key is immutable while a row is in
    the feed. ``created_at`` stands in for a missing stamp because a keyset row comparison
    against NULL is unknown. ``ix_events_timeline_at_id`` indexes this exact expression, and
    the planner matches it structurally, so changing it needs a migration.
    """
    return func.coalesce(
        case(
            (Event.status == STATUS_REQUESTED, Event.requested_at),
            (Event.status == STATUS_DETECTED, Event.detected_at),
            else_=Event.geolocated_at,
        ),
        Event.created_at,
    )


# Backs the feed keyset (``services.social.get_feed``, ``feed_at DESC, id DESC``)
# over the rows it can serve, so a page reads the index in order instead of sorting. The index
# keeps its original name: renaming it needs a migration.
Index(
    "ix_events_timeline_at_id",
    feed_at(),
    Event.id,
    postgresql_where=and_(
        Event.deleted_at.is_(None),
        Event.hidden_at.is_(None),
        Event.status.in_((STATUS_GEOLOCATED, STATUS_REQUESTED, STATUS_DETECTED)),
    ),
)
