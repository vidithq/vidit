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
    ``created`` is new ``detected`` rows; ``updated`` an open ``detected``
    detection the import overwrote with a newer parse; ``skipped`` a detection the
    import left alone, either because the row it matched is not one to touch
    or because that row was already up to date; ``failed`` a detection that
    raised mid-persist and was rolled back (the others still land). ``error``
    stays operator-oriented and terse; the owner gets the human story by email.
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
    updated: int = Field(validation_alias="updated_count")
    skipped: int = Field(validation_alias="skipped_count")
    failed: int = Field(validation_alias="failed_count")
    error: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CoordsRead(BaseModel):
    """One WGS84 point on the wire. Nesting (instead of flat ``lat`` / ``lng``
    pairs) lets a payload carry two independent points, the subject and the
    camera, without field-name gymnastics."""

    lat: float
    lng: float


class ArchivedLinkRead(BaseModel):
    """One link's archived copy: where it lives, and who holds it.

    One copy per link, from whichever provider the analyst used, so the field
    carrying this is ``null`` exactly when no copy has been recorded. An object
    rather than a bare URL because the read surface picks its icon from
    ``provider``, and because the primary source, each mirror and the
    provenance link all serialise through this one shape.
    """

    model_config = ConfigDict(from_attributes=True)

    # The snapshot, as the analyst recorded it (validated against the link it
    # archives, see ``services/source_archive.validate_snapshot``).
    url: str
    # Which service holds it, inferred from the snapshot's host at write time.
    provider: SourceArchiveProvider


# How long the note an editor may attach to one version runs. Short on
# purpose: it says what changed and why, and the argument itself belongs in the
# proof body. The column stays unbounded ``Text``; this is the boundary cap, so
# an over-long note is a 422 on the field rather than a database error.
VERSION_NOTE_MAX_LENGTH = 280


class EventVersionRead(BaseModel):
    """One superseded version of an event.

    ``version_no`` is the version this row holds, not the version that replaced
    it: an event at ``version_no`` 3 answers with snapshots 2 and 1, and the
    live row is version 3. ``snapshot`` carries the editable fields as they
    stood (see ``services/versions.build_snapshot``); the evidence anchor
    (``source_url`` and the source media) is absent because no edit can move it,
    so the live row is authoritative for it at every version.
    """

    id: uuid.UUID
    version_no: int
    # Who made the edit that superseded this version. NULL once that account is
    # erased, or when it was soft-deleted (the serializer drops it for the same
    # reason ``EventRead.requested_by`` does).
    edited_by: AuthorRef | None
    # The editor's own words about the edit. NULL when they left none, and on a
    # redacted version, whose note is blanked with its snapshot.
    note: str | None
    # When the edit that superseded this version happened.
    created_at: datetime
    # The editable fields as they stood, and ``{}`` on a redacted version.
    snapshot: dict[str, Any]
    # Whether an admin blanked this version's content. The row and its number
    # stay either way, so ``/vN`` addressing never shifts and the history still
    # shows that a version existed.
    redacted: bool

    model_config = ConfigDict(from_attributes=True)


class EventVersionList(BaseModel):
    """An event's history: the superseded versions, newest first.

    Paged like every other list (``Link: rel="next"``, opaque cursor);
    ``total`` is the whole history, not the page.
    """

    items: list[EventVersionRead]
    total: int


class EventCloseRequest(BaseModel):
    """Body for ``POST /events/{id}/close``. The reason is required: a closed
    event stays publicly visible, so the why must travel with it."""

    close_reason: str = Field(min_length=1, max_length=2000)


# Largest page ``GET /events/detections`` will serve, whatever ``per_page``
# asks for. Kept equal to ``services/pagination.MAX_PAGE_SIZE`` (the clamp the
# endpoint applies); stated here as a literal so schemas stay import-free of
# the service layer.
DETECTIONS_MAX_PER_PAGE = 100

# How many detections one batch completion may carry: a full page of the queue, so
# whatever the analyst can see they can publish in one call, and no client can
# ask for an unbounded loop of row-level transactions.
MAX_COMPLETION_ROWS = DETECTIONS_MAX_PER_PAGE

# How many conflicts one batch may set. The selection shares them, and an
# import dominated by more than a handful of conflicts is not a batch.
MAX_COMPLETION_CONFLICTS = 10


class BatchCompletionRowCreate(BaseModel):
    """One detection in a batch completion: which row, and the capture source its
    analyst picked for it."""

    event_id: uuid.UUID
    capture_source_tag_id: uuid.UUID


class BatchCompletionCreate(BaseModel):
    """Body of ``POST /events/batch-complete``.

    The conflict set is chosen once for the whole selection (an import is
    usually dominated by one conflict); the capture source varies row to row.
    """

    conflict_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_COMPLETION_CONFLICTS)
    rows: list[BatchCompletionRowCreate] = Field(min_length=1, max_length=MAX_COMPLETION_ROWS)

    @field_validator("rows")
    @classmethod
    def _reject_duplicate_events(
        cls, rows: list[BatchCompletionRowCreate]
    ) -> list[BatchCompletionRowCreate]:
        """One row per detection: a repeated ``event_id`` is a 422, not a retry.

        The second occurrence can only fail (the first published the detection, so
        the row is no longer ``detected``), which would inflate ``failed`` and
        report a state error against a detection that did publish. A client sending
        the same id twice is asking two different things of one row anyway,
        since each occurrence carries its own capture source.
        """
        seen: set[uuid.UUID] = set()
        for row in rows:
            if row.event_id in seen:
                raise ValueError(f"Duplicate event_id in rows: {row.event_id}")
            seen.add(row.event_id)
        return rows


class BatchCompletionRowRead(BaseModel):
    """One row's outcome. ``code`` / ``message`` are NULL when the detection
    published; otherwise they carry the same stable error code the single-row
    geolocate would have answered with, so the queue can render the reason
    against that row."""

    event_id: uuid.UUID
    published: bool
    code: str | None
    message: str | None


class BatchCompletionRead(BaseModel):
    """Response of ``POST /events/batch-complete``: the per-row verdicts in the
    order they were submitted, plus the two headline counts."""

    published: int
    failed: int
    rows: list[BatchCompletionRowRead]


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
    # The declared footage source. NULL only on a machine detection
    # (the imported tweet declared none); ``requested`` / ``geolocated`` rows
    # always carry one (``ck_events_source_url_status``). Required-nullable
    # like ``event_coords``: the key is always serialised.
    source_url: str | None
    # The archived copy of ``source_url``, rendered as the fallback once the
    # original dies. NULL when the owner has recorded none, which is every
    # link's starting state: archival is an act the analyst performs, so a copy
    # exists only where one was pasted back. Required-nullable: the key is
    # always serialised.
    archived_source: ArchivedLinkRead | None
    # Mirrors of the same media on other networks (or other same-POV posts), in
    # the order the submitter gave them. Empty when the event declares none;
    # always serialised. Unlike ``source_url`` these are not the frozen evidence
    # anchor: a fulfiller replaces the whole list at the geolocate transition.
    secondary_source_urls: list[str]
    # The archived copies of ``secondary_source_urls``, same length and same
    # order: entry ``i`` covers mirror ``i``, NULL on the same terms as
    # ``archived_source``. A parallel list rather than fields on the mirrors
    # keeps ``secondary_source_urls`` the shape every existing consumer reads.
    archived_secondary_sources: list[ArchivedLinkRead | None]
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
    # NULL until the event is closed.
    closed_at: datetime | None
    # TRUE when the footage shows death, injury or human remains, set by the
    # author on the write forms and overridable by an admin. Plain ``bool``: the
    # column is NOT NULL, so the key always carries a real value.
    is_graphic: bool
    # The 4-value lifecycle: ``requested`` / ``detected`` / ``geolocated`` /
    # ``closed``. See ``models.event.STATUS_*``.
    status: EventStatus
    # Which version of the event this payload is. 1 until the owner edits it;
    # each edit files the superseded state and increments this. Every state
    # carries it (the column is NOT NULL), but only a ``geolocated`` row can
    # move past 1, since ``save_version`` is the published-row correction path.
    version_no: int
    # Free-text reason the event was closed; NULL while it is open.
    close_reason: str | None
    # The status held just before ``closed`` (withdrawn vs rejected); drives the
    # badge + requested-view routing. NULL while the event is open.
    before_closed_status: BeforeClosedStatus | None
    # The post a machine detection was imported from, a provenance link
    # distinct from ``source_url`` (footage origin). NULL for human submits.
    detected_from_url: str | None
    # Which of the three ingest entries produced the detection: ``bot``, ``paste``
    # or ``archive``. Read-only, stamped at creation and never moved, so a
    # re-import through another entry does not rewrite it. NULL for human
    # submits and for machine rows that predate the column.
    detected_via: DetectedVia | None
    # The archived copy of ``detected_from_url``, same shape and same NULL
    # conditions as ``archived_source``: the provenance link is archivable on
    # the same terms as the footage source.
    archived_detected_from: ArchivedLinkRead | None
    owner: AuthorRef
    # Who opened the request, preserved across fulfilment. NULL for a
    # directly-submitted geolocation (no request preceded it).
    requested_by: AuthorRef | None
    # Durable geolocation credit, oldest first. Empty until ``geolocated``.
    geolocators: list[AuthorRef]
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
    # See ``EventRead.is_graphic``; the card covers its thumbnail on it.
    is_graphic: bool
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
    tags + conflicts to name what a detection is still missing without a per-row
    round-trip.

    ``total`` counts the set the ``readiness`` filter selected, so the page
    count the queue renders describes what it is paging through.
    ``ready_total`` and ``incomplete_total`` split the whole queue whatever
    ``readiness`` asks for, so the queue states both figures without a second
    call and without paging: they sum to ``total`` on the unfiltered queue.
    """

    items: list[EventRead]
    total: int
    page: int
    per_page: int
    ready_total: int
    incomplete_total: int


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
