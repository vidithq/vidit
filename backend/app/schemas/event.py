import uuid
from datetime import date, datetime, time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.archive_import_job import ArchiveImportJobStatus
from app.models.event import (
    BeforeClosedStatus,
    DetectedVia,
    EventStatus,
)
from app.models.source_archive import SourceArchiveProvider
from app.schemas.conflict import ConflictRead
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class PresignedUploadRead(BaseModel):
    """One browser direct-to-storage upload: POST a multipart form to ``url``
    with every ``fields`` entry ahead of the file part (S3 ignores fields
    after the file)."""

    url: str
    fields: dict[str, str]


class ArchiveImportPresignRead(BaseModel):
    """Response of ``POST /events/import-archive/presign``."""

    upload_key: str
    upload: PresignedUploadRead


class ArchiveImportEnqueue(BaseModel):
    """Body of the JSON enqueue. ``post_estimate`` is a cosmetic volume hint
    (the worker stamps the exact ``progress_total``)."""

    upload_key: str = Field(min_length=1, max_length=512)
    # Bounded so an oversized int is a 422, not a 500 at the Integer column.
    post_estimate: int | None = Field(default=None, ge=1, le=10_000_000)


class ArchiveImportJobRead(BaseModel):
    """One archive-import job as the owner polls it.

    ``status`` walks ``queued`` → ``running`` → ``done`` | ``failed``. The
    counts are final once ``done`` (zero until then): ``created`` is new
    ``detected`` rows; ``updated`` an open detection overwritten by a newer
    parse; ``skipped`` a detection left alone (the matched row is not one to
    touch, or already up to date); ``failed`` a detection that raised
    mid-persist and was rolled back (the others still land).
    """

    id: uuid.UUID
    status: ArchiveImportJobStatus
    # ``post_estimate`` is a display hint stamped at enqueue; ``progress_*`` is
    # the worker's live scan position once the detection count is exact.
    post_estimate: int | None
    progress_done: int
    progress_total: int | None
    created: int = Field(validation_alias="created_count")
    updated: int = Field(validation_alias="updated_count")
    skipped: int = Field(validation_alias="skipped_count")
    failed: int = Field(validation_alias="failed_count")
    error: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CoordsRead(BaseModel):
    """One WGS84 point on the wire, nested so a payload can carry two points."""

    lat: float
    lng: float


class ArchivedLinkRead(BaseModel):
    """One link's archived copy: where it lives, and who holds it.

    ``null`` on the carrying field means no copy is recorded. An object so the
    read surface can pick an icon from ``provider``.
    """

    model_config = ConfigDict(from_attributes=True)

    # The snapshot URL (provider and path shape checked by
    # ``services/source_archive.validate_snapshot``).
    url: str
    # Inferred from the snapshot's host at write time.
    provider: SourceArchiveProvider


# Boundary cap on the note attached to a version (the column is unbounded
# ``Text``), so an over-long note is a 422.
VERSION_NOTE_MAX_LENGTH = 280


class EventVersionRead(BaseModel):
    """One superseded version of an event.

    ``version_no`` is the version this row holds: an event at version 3
    answers with snapshots 2 and 1. ``snapshot`` carries the editable fields as
    they stood (``services/versions.build_snapshot``), including the evidence
    anchor and the source media as the shape ``EventRead`` serves, since the
    row itself is gone after a correction.
    """

    id: uuid.UUID
    version_no: int
    # NULL once that account is erased or soft-deleted (same as
    # ``EventRead.requested_by``).
    edited_by: AuthorRef | None
    # NULL when none was left, and on a redacted version.
    note: str | None
    created_at: datetime
    # ``{}`` on a redacted version.
    snapshot: dict[str, Any]
    # Whether an admin blanked this version; the row and number stay.
    redacted: bool

    model_config = ConfigDict(from_attributes=True)


class EventVersionList(BaseModel):
    """An event's history: the superseded versions, newest first.

    Paged like every other list; ``total`` is the whole history.
    """

    items: list[EventVersionRead]
    total: int


class EventCloseRequest(BaseModel):
    """Body for ``POST /events/{id}/close``. The reason is required because a
    closed event stays public."""

    close_reason: str = Field(min_length=1, max_length=2000)


# Largest page ``GET /events/detections`` serves. Equals
# ``services/pagination.MAX_PAGE_SIZE``, as a literal so schemas stay
# import-free of services.
DETECTIONS_MAX_PER_PAGE = 100

# Detections per batch completion: one queue page, so no client can request an
# unbounded loop of row-level transactions.
MAX_COMPLETION_ROWS = DETECTIONS_MAX_PER_PAGE

# Conflicts per batch.
MAX_COMPLETION_CONFLICTS = 10


class BatchCompletionRowCreate(BaseModel):
    """One detection in a batch completion and its chosen capture source."""

    event_id: uuid.UUID
    capture_source_tag_id: uuid.UUID


class BatchCompletionCreate(BaseModel):
    """Body of ``POST /events/batch-complete``.

    One conflict set for the whole selection; the capture source varies per row.
    """

    conflict_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_COMPLETION_CONFLICTS)
    rows: list[BatchCompletionRowCreate] = Field(min_length=1, max_length=MAX_COMPLETION_ROWS)

    @field_validator("rows")
    @classmethod
    def _reject_duplicate_events(
        cls, rows: list[BatchCompletionRowCreate]
    ) -> list[BatchCompletionRowCreate]:
        """One row per detection: a repeated ``event_id`` is a 422.

        The second occurrence could only fail (the first published the row),
        inflating ``failed`` for a detection that did publish.
        """
        seen: set[uuid.UUID] = set()
        for row in rows:
            if row.event_id in seen:
                raise ValueError(f"Duplicate event_id in rows: {row.event_id}")
            seen.add(row.event_id)
        return rows


class BatchCompletionRowRead(BaseModel):
    """One row's outcome. ``code`` / ``message`` are NULL when published,
    otherwise the stable error code the single-row geolocate would return."""

    event_id: uuid.UUID
    published: bool
    code: str | None
    message: str | None


class BatchCompletionRead(BaseModel):
    """Response of ``POST /events/batch-complete``: verdicts in submission order."""

    published: int
    failed: int
    rows: list[BatchCompletionRowRead]


class EventRead(BaseModel):
    id: uuid.UUID
    title: str
    # Nullable (a ``requested`` event may lack coordinates), present for every
    # ``geolocated`` row. Required-nullable: ``build_event_read`` always passes
    # it, so the key is always serialised.
    event_coords: CoordsRead | None
    # Where the footage was shot from.
    capture_source_coords: CoordsRead | None
    # NULL only on a machine detection; ``requested`` / ``geolocated`` rows
    # always carry one (``ck_events_source_url_status``). Required-nullable.
    source_url: str | None
    # The archived copy of ``source_url``, the fallback once the original dies.
    # NULL until the owner pastes one back. Required-nullable.
    archived_source: ArchivedLinkRead | None
    # Mirrors of the same media on other networks, in submitted order. Not the
    # evidence anchor: a submitter replaces the whole list at geolocate and at
    # every later correction.
    secondary_source_urls: list[str]
    # Archived copies of ``secondary_source_urls``: same length and order,
    # entry ``i`` covers mirror ``i``, NULL like ``archived_source``.
    archived_secondary_sources: list[ArchivedLinkRead | None]
    proof: dict[str, Any] | None
    event_date: date | None
    # UTC; NULL when the hour is unknown.
    event_time: time | None
    # When the original source posted the media (UTC). NULL when unknown.
    # Distinct from ``event_date`` and ``created_at``. Required-nullable.
    source_posted_at: datetime | None
    created_at: datetime
    # When the row became ``geolocated``: the date credited to version 1 on the
    # version pages. NULL until publication.
    geolocated_at: datetime | None
    # NULL until the event is closed.
    closed_at: datetime | None
    # Footage shows death, injury or human remains (author-set, admin
    # overridable). Plain ``bool``: the column is NOT NULL.
    is_graphic: bool
    # See ``models.event.STATUS_*``.
    status: EventStatus
    # Version this payload is: 1 until edited, then incremented per edit. Only a
    # ``geolocated`` row can move past 1 (``save_version``).
    version_no: int
    # NULL while open.
    close_reason: str | None
    # Drives the badge and requested-view routing. NULL while open.
    before_closed_status: BeforeClosedStatus | None
    # The post a machine detection was imported from (not the footage origin).
    # NULL for human submits.
    detected_from_url: str | None
    # Ingest entry that produced the detection. Read-only, never moved by a
    # re-import. NULL for human submits and older machine rows.
    detected_via: DetectedVia | None
    # Archived copy of ``detected_from_url``, same terms as ``archived_source``.
    archived_detected_from: ArchivedLinkRead | None
    owner: AuthorRef
    # Who opened the request, kept across fulfilment. NULL for a direct geolocation.
    requested_by: AuthorRef | None
    # Durable geolocation credit, oldest first. Empty until ``geolocated``.
    geolocators: list[AuthorRef]
    # ONLY ``source`` rows: proof images travel inside the proof JSON.
    media: list[MediaRead]
    # Card / preview thumbnail (``services.thumbnails`` owns the pick rule), so
    # a preview needn't re-derive it client-side.
    thumbnail: MediaRead | None
    tags: list[TagRead]
    conflicts: list[ConflictRead]

    model_config = {"from_attributes": True}


class EventList(BaseModel):
    id: uuid.UUID
    title: str
    # Required-nullable like ``EventRead.event_coords``.
    event_coords: CoordsRead | None
    event_date: date | None
    # See ``EventRead.is_graphic``.
    is_graphic: bool
    # See ``EventRead.status``.
    status: EventStatus
    # Tells a withdrawn request, rejected detection and retracted geolocation apart.
    before_closed_status: BeforeClosedStatus | None
    owner: AuthorRef
    # Card thumbnail (``services.thumbnails``), None when neither exists. One
    # media keeps the list light; ``EventRead.media`` has the full set. No
    # default so a constructor can't silently ship a false "no media".
    media: MediaRead | None
    tags: list[TagRead]
    conflicts: list[ConflictRead]

    model_config = {"from_attributes": True}


class PaginatedEvents(BaseModel):
    items: list[EventList]
    total: int
    page: int
    per_page: int


class PaginatedEventDetails(BaseModel):
    """Full-detail paginated events: the owner Detections-queue payload.

    Carries ``EventRead`` items so the queue can judge media and name missing
    tags and conflicts without a per-row round-trip. ``total`` counts the set
    the ``readiness`` filter selected; ``ready_total`` and ``incomplete_total``
    split the whole queue regardless of that filter.
    """

    items: list[EventRead]
    total: int
    page: int
    per_page: int
    ready_total: int
    incomplete_total: int


class PossibleDuplicateRead(BaseModel):
    """Soft-warning hit on the submit form's possible-duplicate probe."""

    id: uuid.UUID
    title: str
    # Always located: the query filters ``status IN (geolocated, detected)`` and
    # skips NULL-coordinate rows.
    event_coords: CoordsRead
    # Nullable but always serialised (``duplicates.list_possible_duplicates``).
    event_date: date | None
    # A ``detected`` candidate may carry no source. Required-nullable.
    source_url: str | None
    # Geodesic distance in metres from the caller-supplied (lat, lng); float so
    # small distances don't round.
    distance_m: float
    owner: AuthorRef

    model_config = {"from_attributes": True}
