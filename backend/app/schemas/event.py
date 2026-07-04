import uuid
from datetime import date, datetime, time
from typing import Any

from pydantic import BaseModel, Field

from app.models.event import BeforeClosedStatus, EventStatus
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class ArchiveImportResult(BaseModel):
    """Outcome of an archive backfill: how the detections landed.

    The assemble counts. ``created`` is new ``detected`` rows; ``skipped`` a pair
    a live row already held; ``recreated`` a previously rejected pair
    re-detected; ``failed`` a detection that raised mid-persist and was
    rolled back (the others still land).
    """

    created: int
    skipped: int
    recreated: int
    failed: int


class CoordsRead(BaseModel):
    """One WGS84 point on the wire. Nesting (instead of flat ``lat`` / ``lng``
    pairs) lets a payload carry two independent points, the subject and the
    camera, without field-name gymnastics."""

    lat: float
    lng: float


class EventCloseRequest(BaseModel):
    """Body for ``POST /events/{id}/close``. The reason is required: a closed
    event stays publicly visible, so the why must travel with it."""

    close_reason: str = Field(min_length=1, max_length=2000)


class EventRead(BaseModel):
    id: uuid.UUID
    title: str
    # The subject point. Nullable: a ``requested`` event may have no coordinates
    # yet (or only an approximate guess), and this same read serves the
    # requested view. Present for every ``geolocated`` row. Required-nullable,
    # not optional: ``build_event_read`` (the sole constructor) always passes
    # it, so the key is always serialised.
    event_coords: CoordsRead | None
    # The camera point: where the footage was shot from. Always optional.
    capture_source_coords: CoordsRead | None
    source_url: str
    proof: dict[str, Any] | None
    event_date: date | None
    # Optional time-of-day for ``event_date`` (UTC); NULL when the hour is unknown.
    event_time: time | None
    # When the original source posted the media: a real post instant (UTC),
    # always present. Distinct from ``event_date`` (when the event happened) and
    # ``created_at`` (submission).
    source_posted_at: datetime
    created_at: datetime
    updated_at: datetime
    # Per-state entry stamps; each is NULL until the event enters that state.
    requested_at: datetime | None
    detected_at: datetime | None
    geolocated_at: datetime | None
    closed_at: datetime | None
    is_demo: bool
    # The 4-value lifecycle: ``requested`` / ``detected`` / ``geolocated`` /
    # ``closed``. See ``models.event.STATUS_*``.
    status: EventStatus
    # Free-text reason the event was closed; NULL while it is open.
    close_reason: str | None
    # The status held just before ``closed`` (withdrawn vs rejected); drives the
    # badge + requested-view routing. NULL while the event is open.
    before_closed_status: BeforeClosedStatus | None
    # The post a machine detection was imported from, a provenance link
    # distinct from ``source_url`` (footage origin). NULL for human submits.
    detected_from_url: str | None
    # When the analyst posted this geolocation on X (the imported tweet's time);
    # NULL for human submits. The "who geolocated first" precedence signal.
    detected_post_at: datetime | None
    owner: AuthorRef
    # Who opened the request, preserved across fulfilment. NULL for a
    # directly-submitted geolocation (no request preceded it).
    requested_by: AuthorRef | None
    # Durable geolocation credit, oldest first. Empty until ``geolocated``.
    geolocators: list[AuthorRef]
    # "I'm working on this" signals, newest first, with the full list on the
    # detail read (the list card carries a capped sample instead).
    investigator_count: int
    investigators: list[AuthorRef]
    # ONLY the ``source`` rows: proof images travel inside the proof JSON as
    # URLs, so surfacing their rows here would double-render them.
    media: list[MediaRead]
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class EventList(BaseModel):
    id: uuid.UUID
    title: str
    # Nullable for the same reason as ``EventRead.event_coords``.
    # Required-nullable, not optional: every list constructor always passes it,
    # so the key is always serialised.
    event_coords: CoordsRead | None
    event_date: date | None
    is_demo: bool
    # See ``EventRead.status``; a list card marks ``detected`` too.
    status: EventStatus
    # Lets the card tell a withdrawn request from a rejected detection.
    before_closed_status: BeforeClosedStatus | None
    owner: AuthorRef
    # The card thumbnail: the event's single ``source`` media, None when it has
    # none. One media on purpose so the list payload stays light; the full set
    # lives on ``EventRead.media``. Required (no default) so a
    # constructor can't silently omit it and ship a false "no media".
    media: MediaRead | None
    tags: list[TagRead]
    # Investigator aggregates, populated on the requested view only (count +
    # newest-first capped sample) so the card renders "N working" without N+1;
    # None on the located view.
    investigator_count: int | None = None
    investigators_sample: list[AuthorRef] | None = None

    model_config = {"from_attributes": True}


class PaginatedEvents(BaseModel):
    items: list[EventList]
    total: int
    page: int
    per_page: int


class PaginatedEventDetails(BaseModel):
    """Full-detail paginated events: the owner Detections-queue payload.

    Mirrors ``PaginatedEvents`` but carries ``EventRead`` items
    (media + tags + provenance) rather than the lightweight ``EventList``
    card: the Detections queue needs the media to judge a detection and the tags
    to compute submit-readiness (source media + a ``conflict`` + a
    ``capture_source`` tag) without a per-row round-trip.
    """

    items: list[EventRead]
    total: int
    page: int
    per_page: int


class PossibleDuplicateRead(BaseModel):
    """Soft-warning hit on the submit form's possible-duplicate probe.

    Just the bits the analyst needs to recognise "that's the same event" and
    decide whether to abandon their in-progress submission. The full detail page
    is one click away for the proof body / media.
    """

    id: uuid.UUID
    title: str
    # A duplicate candidate is always a located row: the query filters
    # ``status IN (geolocated, detected)`` (and the proximity predicate skips
    # NULL-coordinate rows), so the point is always present; the event date is
    # nullable, as it is often unknown for a machine detection.
    event_coords: CoordsRead
    # Nullable (often unknown for a machine detection) but always serialised:
    # the sole constructor (``duplicates.list_possible_duplicates``) passes it.
    event_date: date | None
    source_url: str
    # Geodesic distance in metres from the caller-supplied (lat, lng). Float
    # (not int) so the frontend renders "120 m" vs "0.4 km" without rounding
    # artefacts at small distances.
    distance_m: float
    owner: AuthorRef

    model_config = {"from_attributes": True}
