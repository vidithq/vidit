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

# Lifecycle status — the merged bounty + geolocation event lifecycle.
#   ``requested``   an open call to geolocate (yesterday's bounty ``open``); no
#                   location yet.
#   ``detected``    a machine draft (archive import / the bot); public on every
#                   read surface but clearly marked, may or may not carry a
#                   location (a coord-less draft is a media-only detection).
#   ``geolocated``  a person vouched for it and froze it (yesterday's geolocation
#                   ``submitted`` + a fulfilled bounty); always has a location.
#   ``closed``      withdrawn (a ``requested`` event the author dropped) or
#                   rejected (a ``detected`` row the owner threw out).
# ``location`` is independent of ``status`` (held by the CHECK below): only
# ``geolocated`` requires it and only ``requested`` forbids it. The alias is the
# value-domain source of truth: the ORM column, the Read schemas, and (via the
# OpenAPI spec) the generated frontend type all derive from it, so adding a
# state is a one-line change here.
EventStatus = Literal["requested", "detected", "geolocated", "closed"]
STATUS_REQUESTED: EventStatus = "requested"
STATUS_DETECTED: EventStatus = "detected"
STATUS_GEOLOCATED: EventStatus = "geolocated"
STATUS_CLOSED: EventStatus = "closed"

# Field-length ceilings for the create / edit multipart forms, kept next to the
# columns so a Form(...) ``max_length`` can't drift from them. ``TITLE`` is the
# ``title`` column width; ``SOURCE_URL`` is an input ceiling only — the column is
# unbounded ``Text``, but the API caps accepted input at the boundary.
TITLE_MAX_LENGTH = 255
SOURCE_URL_MAX_LENGTH = 2000


class EventClaim(Base):
    """Soft, public "I'm working on this" signal on a ``requested`` event.

    Folded in from the old ``bounty_claims`` table when bounties merged into the
    geolocation lifecycle. Multi-claimer by design — geolocation is collaborative
    and partly competitive, several analysts may pull at the same media in
    parallel. The composite PK makes duplicate claims idempotent; a claim never
    gates the event's lifecycle, and the ``event_id`` cascade drops claims
    on hard-delete.
    """

    __tablename__ = "event_claims"

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

    geolocation = relationship("Event", back_populates="claims")
    user = relationship("User")

    __table_args__ = (
        # "Who's working on request X right now?" — the detail page's query.
        Index(
            "ix_event_claims_event_id_created_at",
            "event_id",
            "created_at",
        ),
        # "What is this user working on?" — profile / dashboard view.
        Index("ix_event_claims_user_id", "user_id"),
    )


class Event(Base):
    """One event across the merged bounty + geolocation lifecycle.

    ``status`` (see ``EventStatus``) is the lifecycle. ``location`` is an
    independent nullable axis: NULL for a ``requested`` event (no coordinates
    yet), required for a ``geolocated`` one (a vouched geolocation has a place),
    and either for ``detected`` / ``closed`` — enforced by
    ``ck_events_location_status``. Fulfilling a request is a single
    ``UPDATE status='geolocated', location=…`` on this row, not a copy into a new
    one (the pre-merge promotion apparatus is gone).
    """

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Edit-rights owner. For a ``requested`` event this is the poster; it hands to
    # the fulfiller when they geolocate it, so today's trivial permissions hold.
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Who opened the request, preserved across fulfilment so the merge doesn't
    # erase who posted the bounty. NULL for a directly-submitted geolocation.
    # ``ondelete=SET NULL``: a fulfilled event (author transferred to the fulfiller)
    # legitimately outlives its requester, and hard-deleting a user (GDPR erasure)
    # nulls their attribution here rather than failing on the FK.
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    # Nullable: a ``requested`` event has no coordinates yet and a ``detected``
    # one may lack them (a media-only machine draft). Presence is tied to
    # ``status`` by ``ck_events_location_status``.
    location = mapped_column(Geometry("POINT", srid=4326), nullable=True, index=True)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    # NOT NULL: every row carries a proof document. The empty-doc default catches
    # ORM constructions that omit proof; the create flow and machine path pass a
    # real doc. Inline rather than importing ``EMPTY_TIPTAP_DOC`` (models must not
    # depend on services).
    proof = mapped_column(JSONB, nullable=False, default=lambda: {"type": "doc", "content": []})
    # Nullable: often unknown for a ``requested`` event; the submit floor requires
    # it at the ``geolocated`` transition (as with the curated tag categories).
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
    # Set when the event reaches a terminal ``closed`` (withdrawn or rejected).
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Soft-delete: NULL = live, timestamp = removed from public view. Filtered out
    # by every public read; only the admin path acts on soft-deleted rows.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TRUE iff created by an admin demo seeder. Surfaced as a "DEMO" badge;
    # dropped en masse by the wipe button. Real submissions never set this.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    author = relationship("User", foreign_keys=[author_id], back_populates="geolocations")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    media = relationship("Media", back_populates="geolocation", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary="event_tags", back_populates="geolocations")
    claims = relationship(
        "EventClaim",
        back_populates="geolocation",
        cascade="all, delete-orphan",
        order_by="EventClaim.created_at.desc()",
    )

    __table_args__ = (
        # location presence is tied to status: forbidden for ``requested``,
        # required for ``geolocated``, free for ``detected`` / ``closed``.
        CheckConstraint(
            "(status <> 'requested' OR location IS NULL) "
            "AND (status <> 'geolocated' OR location IS NOT NULL)",
            name="ck_events_location_status",
        ),
        # Pin the ``status`` domain at the DB, not just the app-layer Literal: a
        # bad write (a typo, or a new state the location CHECK ignores) is
        # rejected by Postgres. Mirror of ``EventStatus``; keep the two in step.
        CheckConstraint(
            "status IN ('requested', 'detected', 'geolocated', 'closed')",
            name="ck_events_status_valid",
        ),
        # "Open requests / detections / geolocations, newest first" — the list,
        # map and requested-view (ex-bounty) reads all filter on status.
        Index("ix_events_status_created_at", "status", "created_at"),
        # Backs the assemble idempotency look-up (one per detection during a
        # backfill). Partial on the populated cohort — human rows are always NULL.
        Index(
            "ix_events_detected_from_url",
            "detected_from_url",
            postgresql_where="detected_from_url IS NOT NULL",
        ),
    )
