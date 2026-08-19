import uuid
from datetime import UTC, date, datetime, time
from typing import Literal

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Lifecycle status — the merged request + geolocation event lifecycle.
#   ``requested``   an open call to geolocate (a request for help); may
#                   carry an approximate coordinate guess.
#   ``detected``    a machine detection (archive import / the bot); public on every
#                   read surface but clearly marked, may or may not carry a
#                   location (a coord-less one carries media alone).
#   ``geolocated``  a person vouched for it and froze it (yesterday's geolocation
#                   ``submitted`` + a fulfilled request); always has a location.
#   ``closed``      withdrawn (a ``requested`` event the owner dropped),
#                   rejected (a ``detected`` row the owner threw out), or
#                   retracted (a ``geolocated`` row its owner took back, a
#                   public retraction: the page stays readable, the row keeps
#                   its coordinate, credits, archives and version history);
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
# ``detected`` = rejected, ``geolocated`` = retracted. Drives the status badge,
# the requested-view routing, and the read views: a closed detection stays in
# the located catalog, while a retraction leaves every feed and the map (see
# ``services/event_filters.view_predicate``).
BeforeClosedStatus = Literal["requested", "detected", "geolocated"]

# Which of the three ingest entries produced a machine detection. Stamped once, by
# ``detection.persist_detections``, from a value each entry passes; NULL on a human
# submit and on every row written before the column existed. The value domain is
# pinned at the database by ``ck_events_detected_via_valid``; keep the two in
# step. Read-only on the wire, like the other provenance fields.
DetectedVia = Literal["bot", "paste", "archive"]

# Field-length ceilings for the create / edit multipart forms, kept next to the
# columns so a Form(...) ``max_length`` can't drift from them. ``TITLE`` is the
# ``title`` column width; ``SOURCE_URL`` is an input ceiling only — the column is
# unbounded ``Text``, but the API caps accepted input at the boundary.
TITLE_MAX_LENGTH = 255
SOURCE_URL_MAX_LENGTH = 2000
# Ceiling on ``event_source_links`` rows per event (see ``EventSourceLink``).
# The same ceiling the write forms enforce; a submission past it is rejected
# rather than silently truncated.
MAX_SECONDARY_SOURCE_LINKS = 10


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


class EventVersion(Base):
    """One superseded version of a published event, snapshotted at an edit.

    Append-only: a row is written by ``services/events.save_version`` before the edit
    lands, holding the state the event carried up to that moment, and is never
    updated or deleted. ``version_no`` is the number of the version this row
    holds, so it pairs with ``Event.version_no`` (the version the live row is):
    an event at version 3 carries snapshots 1 and 2, and the reading order of
    its history is snapshot 1, snapshot 2, the live row.

    ``snapshot`` holds the structured fields the edit form writes (see
    ``services/versions.build_snapshot``), the evidence anchor included. Media
    rows are not versioned, so a ``proof`` row a snapshot points at is never
    hard-deleted while the snapshot exists
    (``services/evidence_intake.attach_evidence_and_commit`` reads
    ``services/versions.referenced_media_urls`` before it drops one). The
    ``source`` row cannot stay, one per event being the cap, so the snapshot
    describes that media whole and its file is what outlives the row
    (``services/versions.referenced_source_media``).

    Redaction is the one write a filed row takes. An admin blanks ``snapshot``
    and ``note`` and stamps ``redacted_at`` / ``redacted_by_id``; the row and
    its number stay, so ``/vN`` addressing never shifts and the history still
    shows that a version existed. A redacted snapshot references no media, so a
    file only it pointed at becomes deletable again.
    """

    __tablename__ = "event_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # Who made the edit that superseded this version. ``ondelete=SET NULL`` for
    # the same reason as ``Event.requested_by_id``: an event legitimately
    # outlives an editor who is not its owner, and a GDPR erasure nulls their
    # attribution here rather than failing on the FK.
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The editor's own words about the edit. Unbounded ``Text`` like the other
    # free-text columns; the API caps accepted input at
    # ``schemas/event.VERSION_NOTE_MAX_LENGTH``.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot = mapped_column(JSONB, nullable=False)
    # When the edit that superseded this version happened.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # When an admin blanked this version's content, and who did. NULL on every
    # ordinary row: redaction is the moderation exit for a version that carries
    # material the record must not keep serving.
    redacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # ``ondelete=SET NULL`` for the same reason as ``edited_by_id``: erasing the
    # admin account must not fail on the FK, and the redaction itself stands.
    redacted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    event = relationship("Event", back_populates="versions")
    # Only the editor is a relationship: the redacting admin is recorded for the
    # audit trail (``admin_events`` carries the act itself) and never rendered,
    # so the column stands alone.
    edited_by = relationship("User", foreign_keys=[edited_by_id])

    __table_args__ = (
        # One row per version of one event: the append-only writer takes the
        # number off the locked event row, so a duplicate is a bug the database
        # rejects rather than a second history entry for the same version.
        # Its leading ``event_id`` also serves the only read there is, "this
        # event's history, by version", so there is no secondary index.
        UniqueConstraint("event_id", "version_no", name="uq_event_versions_event_no"),
    )


class EventSourceLink(Base):
    """One secondary source link: the same media mirrored on another network,
    or another post from the same point of view.

    The primary evidence anchor stays the scalar ``Event.source_url`` (the first
    place the media was posted, frozen against a fulfiller's rewrite). These are
    ordered extras and carry no such protection: the geolocate transition
    replaces the whole list with whatever the fulfiller submits. ``position`` is
    part of the composite PK, so the stored order IS the read order and a
    duplicate slot is rejected by Postgres; the ``event_id`` cascade drops the
    rows on hard-delete.
    """

    __tablename__ = "event_source_links"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Unbounded ``Text`` like ``Event.source_url``; the API caps accepted input
    # at ``SOURCE_URL_MAX_LENGTH`` at the boundary.
    url: Mapped[str] = mapped_column(Text, nullable=False)

    event = relationship("Event", back_populates="source_links")


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
    # The declared footage source. Nullable: a machine detection may
    # carry none (the imported tweet neither quoted nor linked footage); the
    # ``requested`` and ``geolocated`` states always have one, enforced by
    # ``ck_events_source_url_status`` and required again at the geolocate
    # promotion in ``services/events.geolocate``.
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NOT NULL: every row carries a proof document. The empty-doc default catches
    # ORM constructions that omit proof; the create flow and machine path pass a
    # real doc. Inlined here (a fresh dict per row) rather than importing a shared
    # constant from services, which the models layer must not depend on.
    proof = mapped_column(JSONB, nullable=False, default=lambda: {"type": "doc", "content": []})
    # Nullable: often unknown for a ``requested`` event; the geolocate floor
    # requires it at the ``geolocated`` transition (as with the curated tags).
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Optional time-of-day, in UTC. May stand alone: an approximate hour (sun
    # position, shadows) can be known before the day is, so it does not require
    # ``event_date``. NULL when the hour is unknown.
    event_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    # When the original source (a Telegram channel, an X account, …) posted the
    # media, a full UTC instant. Distinct from ``event_date`` (when the event
    # happened) and ``created_at`` (submission to Vidit). Nullable: filled only
    # when the source's date is actually known (the machine path knows it for a
    # quoted tweet only); never a fabricated placeholder.
    source_posted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
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
    # The post a machine detection was imported from, distinct from
    # ``source_url`` (footage origin). NULL for human submits. The id is the
    # identity every ingest surface keys on, so it is the re-import match
    # anchor; the URL is the display value built from it
    # (``tweet_ingest.urls.canonical_tweet_url``) and what an analyst opens.
    detected_from_tweet_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    detected_from_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Every post id of the thread the detection was read from, the anchor included.
    # The re-import match reads it so the three entries land on one row for one
    # geolocation: an archive stitches a self-thread A→B→C whole and anchors on
    # A, while a bot tag or a paste on C reads one hop and anchors on B, so
    # matching the anchor alone would file one geolocation as two detections. Written
    # once, at creation: it is provenance, not import-owned state. NULL for human
    # submits; rows written before the column carry their anchor id alone.
    detected_thread_tweet_ids: Mapped[list[int] | None] = mapped_column(
        ARRAY(BigInteger), nullable=True
    )
    # Which entry produced this detection (see ``DetectedVia``). Stamped at creation
    # and never moved: a re-import through another entry does not rewrite where
    # the detection first came from. NULL for human submits and for rows that predate
    # the column.
    detected_via: Mapped[DetectedVia | None] = mapped_column(String(20), nullable=True)
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
    # Takedown: NULL = visible, timestamp = withheld from public view after a
    # content report. Filtered out by every public read alongside ``deleted_at``,
    # and reversible (an admin clears it), which is what separates it from the
    # soft-delete: the row is withheld pending judgement, not removed.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TRUE when the footage shows death, injury or human remains. The author
    # sets it on the write forms; an admin overrides it from the moderation
    # endpoint when a submission understated what it carries. The read surface
    # covers a flagged event's imagery until the viewer asks to see it, so the
    # column is public and carried by both read schemas.
    is_graphic: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default=text("false")
    )
    # Which version of the event this row IS. Starts at 1 and is incremented
    # under the row lock by ``services/events.save_version``, which first files the
    # superseded state as an ``EventVersion``. A version number is a public
    # address (``/events/{id}/v{n}``), so it only ever moves forward: a version
    # is never deleted and a number never changes meaning. The server_default
    # keeps every insert correct without setting it, and backfills the rows
    # written before the column as version 1.
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
    # One row per link the owner has recorded an archived copy for. See
    # ``models.source_archive`` for which
    # links those are.
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
    # The superseded versions, oldest first. Append-only (see ``EventVersion``);
    # the cascade drops them with a hard-deleted event.
    versions = relationship(
        "EventVersion",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="EventVersion.version_no",
    )

    __table_args__ = (
        # A geolocated event always has a subject coordinate; the other states
        # are free (a requested event may carry an approximate guess).
        CheckConstraint(
            "status <> 'geolocated' OR event_coords IS NOT NULL",
            name="ck_events_coords_status",
        ),
        # A requested or geolocated event always has a source URL (a request is
        # a call to geolocate someone's footage; a geolocated row is vouched
        # evidence). A detection may carry none, the promotion to
        # ``geolocated`` requires it; ``closed`` keeps whatever it had.
        CheckConstraint(
            "status NOT IN ('requested', 'geolocated') OR source_url IS NOT NULL",
            name="ck_events_source_url_status",
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
            " AND before_closed_status IN ('requested', 'detected', 'geolocated'))"
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
        # Same reason as the status domain above, for the entry that produced a
        # machine detection. NULL is in-domain: a human submit names no entry, and
        # neither does a row written before the column. Mirror of
        # ``DetectedVia``; keep the two in step.
        CheckConstraint(
            "detected_via IS NULL OR detected_via IN ('bot', 'paste', 'archive')",
            name="ck_events_detected_via_valid",
        ),
        # "Open requests / detections / geolocations, newest first" — the list,
        # map and requested-view reads all filter on status.
        Index("ix_events_status_created_at", "status", "created_at"),
        # Backs the re-import match (one look-up per detection during a
        # backfill), which reads an owner's own rows by the post they came from.
        # Partial on the populated cohort: human rows are always NULL.
        Index(
            "ix_events_owner_detected_from_tweet_id",
            "owner_id",
            "detected_from_tweet_id",
            postgresql_where=text("detected_from_tweet_id IS NOT NULL"),
        ),
        # Backs the other leg of the same match, "does this incoming thread share
        # a post with a detection I already hold": an array overlap, which reads off
        # a GIN index. Partial on the populated cohort for the same reason.
        Index(
            "ix_events_detected_thread_tweet_ids",
            "detected_thread_tweet_ids",
            postgresql_using="gin",
            postgresql_where=text("detected_thread_tweet_ids IS NOT NULL"),
        ),
        # Backs the admin machine-detection cohort scans, which count the rows
        # carrying a provenance link at all.
        Index(
            "ix_events_detected_from_url",
            "detected_from_url",
            postgresql_where=text("detected_from_url IS NOT NULL"),
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
        # Backs the keyset the capped list endpoints walk: `/events`,
        # `/events/detections` and `/timeline` all order by
        # ``created_at DESC, id DESC`` and cut their pages with a row
        # comparison over that exact pair
        # (``services/pagination.keyset_before``), which Postgres reads off a
        # composite index on the pair.
        Index("ix_events_created_at_id", "created_at", "id"),
    )
