import uuid
from datetime import date, datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.archive_import_job import ArchiveImportJobStatus
from app.models.event import (
    BeforeClosedStatus,
    DetectedVia,
    EventStatus,
    VersionZero,
)
from app.models.source import SourceKind
from app.schemas import UsernameRef
from app.schemas.conflict import ConflictRead
from app.schemas.media import MediaRead
from app.schemas.source import CoordsRead, SourceRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef

# ``GET /events?sort=``: ``created_at`` then ``id``, descending or ascending.
EventListSort = Literal["newest", "oldest"]


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
    """Body of the JSON enqueue. ``estimated_post_count`` is a cosmetic volume hint
    (the worker stamps the exact ``detection_count``)."""

    upload_key: str = Field(min_length=1, max_length=512)
    # Bounded so an oversized int is a 422, not a 500 at the Integer column.
    estimated_post_count: int | None = Field(default=None, ge=1, le=10_000_000)


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
    # ``estimated_post_count`` is a display hint stamped at enqueue; ``progress_*`` is
    # the worker's live scan position once the detection count is exact.
    estimated_post_count: int | None
    processed_detection_count: int
    detection_count: int | None
    created: int = Field(validation_alias="created_count")
    updated: int = Field(validation_alias="updated_count")
    skipped: int = Field(validation_alias="skipped_count")
    failed: int = Field(validation_alias="failed_count")
    error: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Boundary cap on the note attached to a version (the column is unbounded
# ``Text``), so an over-long note is a 422. Mirrored by
# ``frontend/src/lib/events.ts::VERSION_NOTE_MAX_LEN``; change both.
VERSION_NOTE_MAX_LENGTH = 280
# Mirrored by ``frontend/src/lib/events.ts::CLOSE_REASON_MAX_LEN``; change both.
CLOSE_REASON_MAX_LENGTH = 2000


class EventVersionRead(BaseModel):
    """One superseded version of an event.

    ``version_no`` is the version this row holds: an event at version 3
    answers with snapshots 2 and 1. ``snapshot`` carries the editable fields as
    they stood (``services/versions.build_snapshot``), including each source
    with its links, tags and file as the shape ``SourceRead`` serves, since a
    source an edit drops is gone with its row.
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

    close_reason: str = Field(min_length=1, max_length=CLOSE_REASON_MAX_LENGTH)


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
    """One detection in a batch completion and the kind of its sources that carry a file."""

    event_id: uuid.UUID
    kind: SourceKind


class BatchCompletionCreate(BaseModel):
    """Body of ``POST /events/batch-complete``.

    One conflict set for the whole selection; the source kind varies per row.
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
    otherwise the stable error code the single-row publish would return."""

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
    coords: CoordsRead | None
    # In the order the author set (``models/source.source_order``).
    sources: list[SourceRead]
    # Sanitised HTML (``services/sanitize.sanitize_html``).
    proof: str | None
    occurred_date: date | None
    # UTC; NULL when the hour is unknown.
    occurred_time: time | None
    created_at: datetime
    # When the row became ``geolocated``: the date credited to version 1 on the
    # version pages. NULL until publication.
    geolocated_at: datetime | None
    # NULL until the event is closed.
    closed_at: datetime | None
    # Set only on a withheld event, which only an admin reads.
    hidden_at: datetime | None
    # Whether any source is graphic (``Source.is_graphic``); derived, never stored.
    is_graphic: bool
    # See ``models.event.STATUS_*``.
    status: EventStatus
    # Version this payload is: 0 while a request or a detection, 1 once published, then one
    # higher per edit (``save_version``).
    version_no: int
    # NULL while open.
    close_reason: str | None
    # Drives the badge and requested-view routing. NULL while open.
    before_closed_status: BeforeClosedStatus | None
    # The post a machine detection was imported from (not a source). NULL for
    # human submits.
    detected_from_url: str | None
    # Ingest entry that produced the detection. Read-only, never moved by a
    # re-import. NULL for human submits and older machine rows.
    detected_via: DetectedVia | None
    owner: AuthorRef
    # Who opened the request, kept across fulfilment. NULL for a direct geolocation.
    requested_by: AuthorRef | None
    # Durable geolocation credit, oldest first. Empty until ``geolocated``.
    geolocators: list[AuthorRef]
    # Card / preview thumbnail (``services.thumbnails`` owns the pick rule), so
    # a preview needn't re-derive it client-side.
    thumbnail: MediaRead | None
    tags: list[TagRead]
    conflicts: list[ConflictRead]
    # True on ``GET /events/{id}`` when the signed-in reader holds a pending invitation to share
    # the credit; false for anyone else and on write responses, which only the owner reads.
    viewer_invite_pending: bool = False
    # On ``GET /events/{id}`` and the write responses: what version 0 is, the request or the
    # detection the event was published from (or still is). NULL when the history has no
    # version 0, and on list reads.
    version_zero: VersionZero | None = None

    model_config = {"from_attributes": True}


class EventList(BaseModel):
    id: uuid.UUID
    title: str
    # Required-nullable like ``EventRead.coords``.
    coords: CoordsRead | None
    occurred_date: date | None
    # See ``EventRead.is_graphic``.
    is_graphic: bool
    # See ``EventRead.status``.
    status: EventStatus
    # Tells a withdrawn request, rejected detection and retracted geolocation apart.
    before_closed_status: BeforeClosedStatus | None
    # When the row entered ``requested``: the requests board's age signal. NULL on a row
    # that was never a request.
    requested_at: datetime | None
    owner: AuthorRef
    # See ``EventRead.geolocators``; the card's byline.
    geolocators: list[AuthorRef]
    # Card thumbnail (``services.thumbnails``), None when neither exists. One
    # media keeps the list light; ``EventRead.sources`` has the full set. No
    # default so a constructor can't silently ship a false "no media".
    media: MediaRead | None
    tags: list[TagRead]
    conflicts: list[ConflictRead]

    model_config = {"from_attributes": True}


class GeolocatorInviteCreate(BaseModel):
    """Who to invite: the body of ``POST /events/{id}/geolocator-invites``, and one entry of the
    ``geolocator_invites`` field of the two publishing writes."""

    model_config = ConfigDict(extra="forbid")

    username: UsernameRef


class GeolocatorInviteRead(BaseModel):
    """One pending invitation to share an event's geolocation credit."""

    user: AuthorRef
    invited_at: datetime

    model_config = {"from_attributes": True}


class FeedItemRead(EventList):
    """One feed row: an event card plus when it entered the feed.

    ``status`` tells the two kinds apart, ``geolocated`` and ``requested``; ``owner`` is the
    analyst credited (``services.social.get_feed``).
    """

    # ``requested_at`` for a request, ``geolocated_at`` for a geolocation: the sort key.
    feed_at: datetime


class DayCount(BaseModel):
    date: date
    count: int


class DateHistogram(BaseModel):
    """Events per day on each date axis, ascending, days without a row left out, and the events
    in all (``services.event_filters.date_histogram``)."""

    occurred_date: list[DayCount]
    # The UTC day of ``created_at``.
    submitted: list[DayCount]
    # The events under every filter, both date windows included.
    total: int


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
    coords: CoordsRead
    # Nullable but always serialised (``duplicates.list_possible_duplicates``).
    occurred_date: date | None
    # Every link of the candidate's sources, in source order; a ``detected``
    # candidate may carry none.
    source_urls: list[str]
    # Geodesic distance in metres from the caller-supplied (lat, lng); float so
    # small distances don't round.
    distance_m: float
    owner: AuthorRef

    model_config = {"from_attributes": True}
