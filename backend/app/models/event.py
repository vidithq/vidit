import uuid
from datetime import UTC, date, datetime, time
from typing import Literal

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Lifecycle status — the merged request + geolocation event lifecycle.
#   ``requested``   an open call to geolocate (yesterday's request ``open``); may
#                   carry an approximate coordinate guess.
#   ``detected``    a machine draft (archive import / the bot); public on every
#                   read surface but clearly marked, may or may not carry a
#                   location (a coord-less draft is a media-only detection).
#   ``geolocated``  a person vouched for it and froze it (yesterday's geolocation
#                   ``submitted`` + a fulfilled request); always has a location.
#   ``closed``      withdrawn (a ``requested`` event the owner dropped) or
#                   rejected (a ``detected`` row the owner threw out);
#                   ``before_closed_status`` records which.
# ``event_coords`` is independent of ``status`` (held by the CHECK below): only
# ``geolocated`` requires it. The alias is the value-domain source of truth: the
# ORM column, the Read schemas, and (via the OpenAPI spec) the generated
# frontend type all derive from it, so adding a state is a one-line change here.
EventStatus = Literal["requested", "detected", "geolocated", "closed"]
STATUS_REQUESTED: EventStatus = "requested"
STATUS_DETECTED: EventStatus = "detected"
STATUS_GEOLOCATED: EventStatus = "geolocated"
STATUS_CLOSED: EventStatus = "closed"

# The status held just before ``closed``: ``requested`` = withdrawn,
# ``detected`` = rejected. Drives the status badge, the requested-view routing,
# and lets re-import treat a closed detection as re-importable.
BeforeClosedStatus = Literal["requested", "detected"]

# Field-length ceilings for the create / edit multipart forms, kept next to the
# columns so a Form(...) ``max_length`` can't drift from them. ``TITLE`` is the
# ``title`` column width; ``SOURCE_URL`` is an input ceiling only — the column is
# unbounded ``Text``, but the API caps accepted input at the boundary.
TITLE_MAX_LENGTH = 255
SOURCE_URL_MAX_LENGTH = 2000


class EventInvestigator(Base):
    """Soft, public "I'm working on this" signal on a ``requested`` event.

    Renamed from ``event_claims`` ("claim" made no sense on an event).
    Multi-analyst by design: geolocation is collaborative and partly
    competitive, several analysts may pull at the same media in parallel. The
    composite PK makes re-signalling idempotent; the signal never gates the
    event's lifecycle, and the ``event_id`` cascade drops rows on hard-delete.
    """

    __tablename__ = "event_investigators"

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

    event = relationship("Event", back_populates="investigators")
    user = relationship("User")

    __table_args__ = (
        # "Who's working on request X right now?" — the detail page's query.
        Index(
            "ix_event_investigators_event_id_created_at",
            "event_id",
            "created_at",
        ),
        # "What is this user working on?" — profile / dashboard view.
        Index("ix_event_investigators_user_id", "user_id"),
    )


class EventGeolocator(Base):
    """Durable credit for the geolocation: who vouched the location.

    Written at the ``geolocate`` transition (at least one row), collaborative
    (N). Replaces the single ``owner_id`` as the attribution source of truth;
    the owner is always among these rows, so a user erasure (which drops the
    events they own) cannot leave a ``geolocated`` event below one geolocator.
    The composite PK makes credit idempotent.
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
        # The composite PK's leading event_id serves "who geolocated event X";
        # this covers the reverse "a user's geolocations" profile query.
        Index("ix_event_geolocators_user_created_at", "user_id", "created_at"),
    )


class Event(Base):
    """One event across the merged request + geolocation lifecycle.

    ``status`` (see ``EventStatus``) is the lifecycle. ``event_coords`` is an
    independent nullable axis: required for a ``geolocated`` row (a vouched
    geolocation has a place), optional otherwise (a ``requested`` event may
    carry an approximate guess), enforced by ``ck_events_coords_status``.
    Fulfilling a request is a single ``UPDATE status='geolocated',
    event_coords=…`` on this row plus an ``event_geolocators`` insert, not a
    copy into a new one.
    """

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Edit-rights owner. For a ``requested`` event this is the poster; it hands
    # to the fulfiller when they geolocate it, so permissions stay a
    # single-owner check across the lifecycle. Always among the event's
    # geolocators once ``geolocated`` (see ``EventGeolocator``).
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Who opened the request, preserved across fulfilment so the merge doesn't
    # erase who posted the request. NULL for a directly-submitted geolocation.
    # ``ondelete=SET NULL``: a fulfilled event (owner transferred to the fulfiller)
    # legitimately outlives its requester, and hard-deleting a user (GDPR erasure)
    # nulls their attribution here rather than failing on the FK.
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    # The subject: what the footage shows. Nullable, required at ``geolocated``,
    # optional otherwise (a ``requested`` event may carry an approximate guess);
    # presence is tied to ``status`` by ``ck_events_coords_status``. One subject
    # point per event; multi-point is a deferred ``event_points`` child table.
    event_coords = mapped_column(Geometry("POINT", srid=4326), nullable=True, index=True)
    # The camera position: where the footage was shot from. Always optional,
    # one per event. Deliberately unindexed: no spatial read consumes it.
    capture_source_coords = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False), nullable=True
    )
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    # NOT NULL: every row carries a proof document. The empty-doc default catches
    # ORM constructions that omit proof; the create flow and machine path pass a
    # real doc. Inline rather than importing ``EMPTY_TIPTAP_DOC`` (models must not
    # depend on services).
    proof = mapped_column(JSONB, nullable=False, default=lambda: {"type": "doc", "content": []})
    # Nullable: often unknown for a ``requested`` event; the geolocate floor
    # requires it at the ``geolocated`` transition (as with the curated tags).
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Optional time-of-day for ``event_date``, in UTC. NULL when the hour is
    # unknown, as the event date is often inferred from context or footage.
    event_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    # When the original source (a Telegram channel, an X account, …) posted the
    # media. A real post instant, hence a full UTC timestamp and NOT NULL.
    # Distinct from ``event_date`` (when the event happened) and ``created_at``
    # (submission to Vidit). On the machine path it equals the imported tweet's
    # timestamp (``source_url`` is the tweet there).
    source_posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # When the analyst published THIS geolocation on X, the post time of
    # ``detected_from_url``. The authorship / precedence signal for "who
    # geolocated this first", consumed later by the claim/dispute pipeline. NULL
    # for human submits (no X import).
    detected_post_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Per-state entry stamps. Each is set when the event enters that state and
    # never cleared; ``geolocated_at`` / ``closed_at`` are tied to ``status`` by
    # CHECKs so an app path that forgets to stamp is rejected at write time.
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    detected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    geolocated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Lifecycle status (see ``STATUS_*``). server_default ``geolocated`` so a
    # direct human submit — the common insert — stays correct without setting it;
    # the requested / detected paths pass ``status`` explicitly.
    status: Mapped[EventStatus] = mapped_column(
        String(20), nullable=False, default=STATUS_GEOLOCATED, server_default=text("'geolocated'")
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
    # Set when the event reaches the terminal ``closed`` (withdrawn or rejected).
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Free-text reason the event was closed (AI image, bot bug, withdrawn…).
    # Kept visible for transparency; a curated reason picker is deferred.
    close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # See ``BeforeClosedStatus``; non-NULL exactly when ``status='closed'``
    # (``ck_events_before_closed_status``).
    before_closed_status: Mapped[BeforeClosedStatus | None] = mapped_column(
        String(20), nullable=True
    )
    # Soft-delete: NULL = live, timestamp = removed from public view. Filtered out
    # by every public read; only the admin path acts on soft-deleted rows.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TRUE iff created by an admin demo seeder. Surfaced as a "DEMO" badge;
    # dropped en masse by the wipe button. Real submissions never set this.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner = relationship("User", foreign_keys=[owner_id], back_populates="events")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    media = relationship("Media", back_populates="event", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary="event_tags", back_populates="events")
    investigators = relationship(
        "EventInvestigator",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventInvestigator.created_at.desc()",
    )
    geolocators = relationship(
        "EventGeolocator",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventGeolocator.created_at",
    )

    __table_args__ = (
        # A geolocated event always has a subject coordinate; the other states
        # are free (a requested event may carry an approximate guess).
        CheckConstraint(
            "status <> 'geolocated' OR event_coords IS NOT NULL",
            name="ck_events_coords_status",
        ),
        # The terminal stamps are tied to status so an app path that forgets to
        # stamp is rejected at write time, not stored as silent bad data.
        CheckConstraint(
            "status <> 'closed' OR closed_at IS NOT NULL",
            name="ck_events_closed_stamp",
        ),
        CheckConstraint(
            "status <> 'geolocated' OR geolocated_at IS NOT NULL",
            name="ck_events_geolocated_stamp",
        ),
        # ``before_closed_status`` is set exactly when a row is ``closed`` (the
        # state it held just before): non-NULL and in-domain on a closed row,
        # NULL on every other status. Full iff, so a closed row can't forget its
        # origin and a live row can't carry a stale discriminator. Mirror of
        # ``BeforeClosedStatus``; keep the two in step.
        CheckConstraint(
            # The explicit ``IS NOT NULL`` is load-bearing: ``NULL IN (...)`` is
            # unknown, so ``status = 'closed' AND (NULL IN ...)`` evaluates to
            # NULL, not FALSE, and Postgres accepts any CHECK that is not FALSE.
            # Without it a closed row could still carry a NULL discriminator.
            "(status = 'closed' AND before_closed_status IS NOT NULL"
            " AND before_closed_status IN ('requested', 'detected'))"
            " OR (status <> 'closed' AND before_closed_status IS NULL)",
            name="ck_events_before_closed_status",
        ),
        # Pin the ``status`` domain at the DB, not just the app-layer Literal: a
        # bad write (a typo, or a new state the coords CHECK ignores) is
        # rejected by Postgres. Mirror of ``EventStatus``; keep the two in step.
        CheckConstraint(
            "status IN ('requested', 'detected', 'geolocated', 'closed')",
            name="ck_events_status_valid",
        ),
        # "Open requests / detections / geolocations, newest first" — the list,
        # map and requested-view (ex-request) reads all filter on status.
        Index("ix_events_status_created_at", "status", "created_at"),
        # Backs the assemble idempotency look-up (one per detection during a
        # backfill). Partial on the populated cohort — human rows are always NULL.
        Index(
            "ix_events_detected_from_url",
            "detected_from_url",
            postgresql_where="detected_from_url IS NOT NULL",
        ),
        # Serves the hot profile read (``GET /users/{username}/events`` filters
        # ``owner_id``) and the admin GDPR delete's owned-event enumeration. Both
        # indexes exist in the DB, renamed from the ``author_id`` era; declared
        # here so the model matches the migration. ``ix_events_owner_id`` is
        # redundant with the composite for a lookup, and the DB carries the
        # composite as ``created_at DESC`` (immaterial to current reads): both
        # noted in planning/next.md for a later index-cleanup pass.
        Index("ix_events_owner_id", "owner_id"),
        Index("ix_events_owner_created", "owner_id", "created_at"),
    )
