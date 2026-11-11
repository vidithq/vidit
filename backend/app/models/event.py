import uuid
from datetime import date, datetime, time
from typing import Any, Literal

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ColumnElement,
    Date,
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

from app.database import Base, CreatedAt, UpdatedAt, literal_check, literal_in
from app.models.source import Source, source_order

EventStatus = Literal["requested", "detected", "geolocated", "closed"]
STATUS_REQUESTED: EventStatus = "requested"
STATUS_DETECTED: EventStatus = "detected"
STATUS_GEOLOCATED: EventStatus = "geolocated"
STATUS_CLOSED: EventStatus = "closed"

BeforeClosedStatus = Literal["requested", "detected", "geolocated"]

# What version 0 of an event is: the request or the detection it was published from, or the
# open row itself (``services/versions.version_zero``).
VersionZero = Literal["request", "detection"]

DetectedVia = Literal["bot", "paste", "archive"]


def _initial_version(context: DefaultExecutionContext) -> int:
    params = context.get_current_parameters()
    state = params.get("before_closed_status") or params.get("status")
    return 0 if state in (STATUS_REQUESTED, STATUS_DETECTED) else 1


# Mirrored by ``frontend/src/lib/events.ts::EVENT_TITLE_MAX_LEN``; change both.
TITLE_MAX_LENGTH = 255

# WGS 84 bounds of ``Event.coords``; ``services.events.validate_coordinates`` enforces them.
LAT_MIN, LAT_MAX = -90.0, 90.0
LNG_MIN, LNG_MAX = -180.0, 180.0


GeolocatorState = Literal["invited", "active", "departed"]


class EventGeolocator(Base):
    __tablename__ = "event_geolocators"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    state: Mapped[GeolocatorState] = mapped_column(String(20))
    invited_at: Mapped[datetime | None]
    joined_at: Mapped[datetime | None]
    departed_at: Mapped[datetime | None]

    user = relationship("User")

    __table_args__ = (
        literal_check("state", GeolocatorState, "ck_event_geolocators_state_valid"),
        CheckConstraint(
            "(state <> 'invited' OR invited_at IS NOT NULL)"
            " AND (state <> 'active' OR joined_at IS NOT NULL)"
            " AND (state <> 'departed' OR departed_at IS NOT NULL)",
            name="ck_event_geolocators_state_stamp",
        ),
        Index(
            "ix_event_geolocators_user_id_joined_at",
            "user_id",
            "joined_at",
            postgresql_where=text("state = 'active'"),
        ),
        Index("ix_event_geolocators_user_id", "user_id"),
    )


class EventVersion(Base):
    __tablename__ = "event_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    version_no: Mapped[int] = mapped_column(Integer)
    # SET NULL: an event outlives a non-owner editor, and a GDPR erasure nulls
    # the attribution instead of failing on the FK.
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    note: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[CreatedAt]
    redacted_at: Mapped[datetime | None]
    redacted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    # Only the editor is a relationship: the redacting admin is audited in
    # ``audit_log`` and never rendered.
    edited_by = relationship("User", foreign_keys=[edited_by_id])

    __table_args__ = (
        UniqueConstraint("event_id", "version_no", name="uq_event_versions_event_no"),
    )


class EventDetection(Base):
    __tablename__ = "event_detections"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    via: Mapped[DetectedVia | None] = mapped_column(String(20))
    from_url: Mapped[str] = mapped_column(Text)
    from_post_id: Mapped[int | None] = mapped_column(BigInteger)
    thread_post_ids: Mapped[list[int] | None] = mapped_column(ARRAY(BigInteger))
    post_at: Mapped[datetime | None]

    event = relationship("Event", back_populates="detection")

    __table_args__ = (
        literal_check("via", DetectedVia, "ck_event_detections_via_valid", nullable=True),
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
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH))
    coords = mapped_column(Geometry("POINT", srid=4326), nullable=True, index=True)
    proof: Mapped[str] = mapped_column(Text, default="")
    occurred_date: Mapped[date | None] = mapped_column(Date)
    occurred_time: Mapped[time | None] = mapped_column(Time)
    requested_at: Mapped[datetime | None]
    detected_at: Mapped[datetime | None]
    geolocated_at: Mapped[datetime | None]
    status: Mapped[EventStatus] = mapped_column(
        String(20), default=STATUS_GEOLOCATED, server_default=text("'geolocated'")
    )

    @hybrid_property
    def is_machine_detection(self) -> bool:
        return self.detection is not None and self.requested_at is None

    @is_machine_detection.inplace.expression
    @classmethod
    def _is_machine_detection_expression(cls) -> ColumnElement[bool]:
        return and_(exists().where(EventDetection.event_id == cls.id), cls.requested_at.is_(None))

    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]
    closed_at: Mapped[datetime | None]
    close_reason: Mapped[str | None] = mapped_column(Text)
    before_closed_status: Mapped[BeforeClosedStatus | None] = mapped_column(String(20))
    deleted_at: Mapped[datetime | None]
    hidden_at: Mapped[datetime | None]
    version_no: Mapped[int] = mapped_column(
        Integer, default=_initial_version, server_default=text("1")
    )

    @hybrid_property
    def is_graphic(self) -> bool:
        return any(source.is_graphic for source in self.sources)

    @is_graphic.inplace.expression
    @classmethod
    def _is_graphic_expression(cls) -> ColumnElement[bool]:
        return exists().where(Source.event_id == cls.id, Source.is_graphic.is_(True))

    owner = relationship("User", foreign_keys=[owner_id], back_populates="events")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    media = relationship("Media", back_populates="event", cascade="all, delete-orphan")
    sources = relationship(
        "Source",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by=lambda: source_order(),
    )
    tags = relationship("Tag", secondary="event_tags", back_populates="events", order_by="Tag.name")
    conflicts = relationship("Conflict", secondary="event_conflicts", back_populates="events")
    geolocators = relationship(
        "EventGeolocator",
        primaryjoin="and_(Event.id == EventGeolocator.event_id, EventGeolocator.state == 'active')",
        viewonly=True,
        order_by="EventGeolocator.joined_at",
    )
    detection = relationship(
        "EventDetection", uselist=False, back_populates="event", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status <> 'geolocated' OR coords IS NOT NULL",
            name="ck_events_coords_status",
        ),
        CheckConstraint(
            "status <> 'closed' OR closed_at IS NOT NULL",
            name="ck_events_closed_stamp",
        ),
        CheckConstraint(
            "status <> 'geolocated' OR geolocated_at IS NOT NULL",
            name="ck_events_geolocated_stamp",
        ),
        CheckConstraint(
            # ``IS NOT NULL`` is load-bearing: ``NULL IN (...)`` is unknown, and
            # Postgres accepts any CHECK that is not FALSE.
            "(status = 'closed' AND before_closed_status IS NOT NULL"
            f" AND {literal_in('before_closed_status', BeforeClosedStatus)})"
            " OR (status <> 'closed' AND before_closed_status IS NULL)",
            name="ck_events_before_closed_status",
        ),
        CheckConstraint(
            "(version_no = 0) = (COALESCE(before_closed_status, status)"
            " IN ('requested', 'detected'))",
            name="ck_events_version_published",
        ),
        literal_check("status", EventStatus, "ck_events_status_valid"),
        Index("ix_events_status_created_at", "status", "created_at"),
        Index("ix_events_owner_id", "owner_id"),
        Index("ix_events_owner_created", "owner_id", "created_at"),
        Index("ix_events_created_at_id", "created_at", "id"),
    )


def feed_at() -> ColumnElement[datetime]:
    """Each stamp is set on entry and never cleared, so the key is immutable while a row is in
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
