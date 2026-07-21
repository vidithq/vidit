import uuid
from datetime import date, datetime, time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.archive_import_job import ArchiveImportJobStatus
from app.models.event import BeforeClosedStatus, EventStatus
from app.schemas.conflict import ConflictRead
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class PresignedUploadRead(BaseModel):
    """One browser direct-to-storage upload: POST a multipart form to ``url``
    with every ``fields`` entry ahead of the file part (S3 ignores fields
    after the file). The same shape whether the target is S3 or the dev
    upload endpoint."""

    url: str
    fields: dict[str, str]


class ArchiveImportPresignRead(BaseModel):
    """Response of ``POST /events/import-archive/presign``: where to upload
    the stripped zip, and the ``upload_key`` to hand back to the enqueue."""

    upload_key: str
    upload: PresignedUploadRead


class ArchiveImportEnqueue(BaseModel):
    """Body of the JSON enqueue. ``upload_key`` is the presign's minted key;
    ``post_estimate`` is the browser strip's cosmetic volume hint (the worker
    stamps the exact ``progress_total``)."""

    upload_key: str = Field(min_length=1, max_length=512)
    # Ceiling far above any real archive: an unbounded client int would blow
    # the Integer column at commit (a 500) instead of a 422 here.
    post_estimate: int | None = Field(default=None, ge=1, le=10_000_000)


class ArchiveImportJobRead(BaseModel):
    """One archive-import job as the owner polls it.

    ``status`` walks ``queued`` → ``running`` → ``done`` | ``failed``. The
    counts are the assemble outcome, final once ``done`` (zero until then):
    ``created`` is new ``detected`` rows; ``skipped`` a pair a live row
    already held; ``recreated`` a previously rejected pair re-detected;
    ``failed`` a detection that raised mid-persist and was rolled back (the
    others still land). ``error`` stays operator-oriented and terse; the
    owner gets the human story by email.
    """

    id: uuid.UUID
    status: ArchiveImportJobStatus
    # Analyst-facing progress: ``post_estimate`` is the free zip-metadata
    # volume hint stamped at enqueue (a display hint, not a promise);
    # ``progress_done`` / ``progress_total`` are the worker's live scan
    # position once the parse has the exact detection count.
    post_estimate: int | None
    progress_done: int
    progress_total: int | None
    created: int = Field(validation_alias="created_count")
    skipped: int = Field(validation_alias="skipped_count")
    recreated: int = Field(validation_alias="recreated_count")
    failed: int = Field(validation_alias="failed_count")
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


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
    # The declared footage source. NULL only on a machine ``detected`` draft
    # (the imported tweet declared none); ``requested`` / ``geolocated`` rows
    # always carry one (``ck_events_source_url_status``). Required-nullable
    # like ``event_coords``: the key is always serialised.
    source_url: str | None
    proof: dict[str, Any] | None
    event_date: date | None
    # Optional time-of-day for ``event_date`` (UTC); NULL when the hour is unknown.
    event_time: time | None
    # When the original source posted the media (UTC). NULL when unknown (a
    # machine detection only knows it for a dated quote). Distinct from
    # ``event_date`` (when the event happened) and ``created_at`` (submission).
    # Required-nullable: the key is always serialised.
    source_posted_at: datetime | None
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
    # The card / preview thumbnail: first ``source`` media, else first
    # ``proof`` image (``services.thumbnails``, the one home for the rule).
    # Lets a preview built on this payload (the map pin hover) show a
    # proof-only event's image without re-deriving the pick client-side.
    thumbnail: MediaRead | None
    tags: list[TagRead]
    conflicts: list[ConflictRead]

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
    # The card thumbnail: first ``source`` media, else first ``proof`` image
    # (``services.thumbnails``), None when the event has neither. One media on
    # purpose so the list payload stays light; the full set lives on
    # ``EventRead.media``. Required (no default) so a constructor can't
    # silently omit it and ship a false "no media".
    media: MediaRead | None
    tags: list[TagRead]
    conflicts: list[ConflictRead]
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
    card: the Detections queue needs the media to judge a detection and the
    tags + conflicts to compute submit-readiness (source media + a conflict +
    a ``capture_source`` tag) without a per-row round-trip.
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
    # Nullable for the same reason: a ``detected`` candidate may carry no
    # source (it can still match on the date leg). Required-nullable.
    source_url: str | None
    # Geodesic distance in metres from the caller-supplied (lat, lng). Float
    # (not int) so the frontend renders "120 m" vs "0.4 km" without rounding
    # artefacts at small distances.
    distance_m: float
    owner: AuthorRef

    model_config = {"from_attributes": True}
