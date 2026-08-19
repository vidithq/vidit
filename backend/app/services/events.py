"""Event lifecycle orchestration over the unified event model.

`routers/events/*` parse the multipart forms into clean Python types and
hand them to the functions here, which own every business rule, the S3 upload
loop, proof-image intake, the DB commit, and the post-commit S3 sweep on
rollback. The write verbs map one-to-one onto the lifecycle:
:func:`create_with_evidence` births a ``geolocated`` row, :func:`create_request`
a ``requested`` one, :func:`geolocate` is the one generalized transition to
``geolocated`` (fulfil a request, vouch a detection), :func:`save_version` corrects a
published row and files the superseded state as a version, and :func:`close`
is the terminal withdraw / reject / retract, available in every live state.

Errors are typed `EventError` subclasses with stable `.code`
strings, translated to HTTP via the same `{code, message}` envelope as
`RegistrationError` / `AdminError`. Status mapping lives in
`routers/events/_common.py` (`_EVENT_ERROR_STATUS`), kept in sync
when adding a code.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from typing import cast

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import ColumnElement, and_, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.conflict import Conflict
from app.models.event import (
    MAX_SECONDARY_SOURCE_LINKS,
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    BeforeClosedStatus,
    Event,
    EventGeolocator,
    EventSourceLink,
)
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.services import source_archive, versions
from app.services.event_filters import visible_events
from app.services.evidence_intake import (
    EvidenceIntakeError,
    MediaRequiredError,
    TooManyFilesError,
    attach_evidence_and_commit,
    collect_media_keys,
)
from app.services.permissions import ensure_owner
from app.services.sanitize import (
    extract_image_srcs,
    sanitize_tiptap_doc,
)
from app.services.storage import sweep_keys

logger = logging.getLogger(__name__)


class EventError(EvidenceIntakeError):
    """Base for event-specific friendly errors.

    Subclass of :class:`EvidenceIntakeError` so the router catches one base
    for both shared file/media failures and the event-specific rules
    below. Carries a ``code`` the router maps to an HTTP status without
    string-matching exception text.
    """

    code: str = "event_error"


class InvalidCoordinatesError(EventError):
    """Coordinates were supplied but fall outside the valid lat / lng ranges.

    About malformed input, not absent input: a transition that needs
    coordinates the row does not carry raises
    :class:`CoordinatesRequiredError` instead. Maps to 400.
    """

    code = "invalid_coordinates"


class CoordinatesRequiredError(EventError):
    """The transition requires coordinates and the row carries none.

    A machine detection may be born without a point (the import found
    no location in the thread), so the requirement bites at the promotion, the
    same shape as :class:`SourceUrlRequiredError`. Maps to 400.
    """

    code = "coordinates_required"


class InvalidProofError(EventError):
    code = "invalid_proof"


class TagRequirementsError(EventError):
    code = "tag_requirements_not_met"


class ProofImageRequiredError(EventError):
    code = "proof_image_required"


class SourceUrlRequiredError(EventError):
    """The geolocate promotion requires a source URL.

    A machine detection may be born without one (the imported tweet
    declared no source), so the requirement bites at the transition: a
    ``geolocated`` row always carries its footage source (the same invariant
    ``ck_events_source_url_status`` pins at the DB). Maps to 400.
    """

    code = "source_url_required"


class TooManySourceLinksError(EventError):
    """More secondary source links than :data:`MAX_SECONDARY_SOURCE_LINKS`.

    Counted after normalization, so blanks and duplicates the client sent don't
    push a legitimate submission over the cap. Maps to 400.
    """

    code = "too_many_source_links"


class EventNotFoundError(EventError):
    """The targeted row is gone (hard-deleted, or soft-deleted by an admin).

    Only the batch completion raises it: the single-row paths resolve the event
    in the router, which owns their 404. In a batch it is one row's outcome, not
    the call's, so it travels as a typed per-row code and never reaches the
    envelope. The 404 it carries in ``_EVENT_ERROR_STATUS`` is defensive, there
    so a future single-row caller of the same helper gets the right status
    instead of a 500.
    """

    code = "event_not_found"


class EventStateError(EventError):
    """The event's lifecycle state forbids the requested transition.

    Raised when a geolocate targets a row that isn't ``requested`` /
    ``detected`` (a ``geolocated`` row is past that transition, ``closed`` is
    terminal), when a close targets an already ``closed`` row, or when a
    :func:`save_version` targets a row that is not ``geolocated`` (there is no version to
    supersede before publication, and a retracted row is not corrected). Maps to
    409: the request is well-formed but conflicts with the row's current state.
    """

    code = "invalid_state"


class NothingChangedError(EventError):
    """The edit would file a version carrying the state the live row carries.

    A version spends a number in a public address space and prints a row in the
    history, so an edit that moves no versioned field is refused rather than
    recorded: the record must not claim a correction that did not happen. The
    note is not a versioned field, so a note on its own does not lift this.
    Maps to 409, like the other "the row's state forbids this" verdicts.
    """

    code = "nothing_changed"


def validate_coordinates(lat: float, lng: float) -> None:
    """Reject out-of-range coordinates: the single bounds check shared by the
    human create + geolocate paths."""
    if not -90 <= lat <= 90:
        raise InvalidCoordinatesError("Latitude must be between -90 and 90")
    if not -180 <= lng <= 180:
        raise InvalidCoordinatesError("Longitude must be between -180 and 180")


def _clean_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """Strip, drop blanks, drop duplicates and drop the primary, order-preserving.

    The shared body of :func:`normalize_secondary_source_urls` (the write forms)
    and :func:`truncate_secondary_source_urls` (the ingest prefill); the two
    differ only in what they do past the cap. Dropping an entry equal to
    ``source_url`` keeps the primary anchor from being listed twice.
    """
    primary = (source_url or "").strip()
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in urls:
        url = raw.strip()
        if not url or url == primary or url in seen:
            continue
        seen.add(url)
        cleaned.append(url)
    return cleaned


def normalize_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """The submitted secondary source links, normalized: the one home every write
    path runs before the rows are written.

    Raises :class:`TooManySourceLinksError` past
    :data:`MAX_SECONDARY_SOURCE_LINKS`. Rejecting rather than truncating is the
    point: an analyst who pasted eleven mirrors should be told, not have the
    eleventh silently dropped.
    """
    cleaned = _clean_secondary_source_urls(urls, source_url)
    if len(cleaned) > MAX_SECONDARY_SOURCE_LINKS:
        raise TooManySourceLinksError(
            f"An event carries at most {MAX_SECONDARY_SOURCE_LINKS} secondary source links"
        )
    return cleaned


def truncate_secondary_source_urls(urls: list[str], source_url: str | None) -> list[str]:
    """The machine-path variant: same normalization, over-cap links dropped.

    A tweet that links twelve mirrors is not an error the ingest can report to
    anyone, so the prefill keeps the first ten and the owner adds the rest by
    hand if they matter.
    """
    return _clean_secondary_source_urls(urls, source_url)[:MAX_SECONDARY_SOURCE_LINKS]


def pair_secondary_snapshots(urls: list[str], snapshots: list[str]) -> dict[str, str]:
    """Map each submitted mirror to the archived copy posted beside it.

    The forms post two aligned repeated fields, ``secondary_source_urls`` and
    ``secondary_snapshot_urls``, one entry each per row, blank where the analyst
    archived nothing. Position is how they arrive and the link is how they are
    stored, so the pairing happens here, on the raw lists, before
    :func:`normalize_secondary_source_urls` drops the blank, duplicate and
    primary-equal rows that would shift every later index.

    A short or absent snapshot list pairs what it covers and leaves the rest
    unarchived, so a client that posts no copies posts nothing extra. The first
    entry wins on a repeated mirror, matching the one the normalization keeps.
    """
    paired: dict[str, str] = {}
    for url, snapshot in zip(urls, snapshots, strict=False):
        link, copy = url.strip(), snapshot.strip()
        if link and copy:
            paired.setdefault(link, copy)
    return paired


def build_source_link_rows(urls: list[str]) -> list[EventSourceLink]:
    """The ordered child rows for an event's secondary links: one home so
    ``position`` is always the list index."""
    return [EventSourceLink(position=index, url=url) for index, url in enumerate(urls)]


def replace_source_links(db: Session, geo: Event, urls: list[str]) -> None:
    """Swap an existing event's secondary links for ``urls``.

    The deletes are FLUSHED before the replacements insert: SQLAlchemy emits a
    mapper's inserts ahead of its deletes, so a reused ``position`` would
    otherwise collide on the composite PK mid-flush.
    """
    geo.source_links.clear()
    db.flush()
    geo.source_links = build_source_link_rows(urls)


def _optional_point(lat: float | None, lng: float | None, *, field: str):
    """Validate + build an optional PostGIS point from a half-typed form pair.

    A lone half of the pair is a client bug, not a droppable value, so reject it
    rather than silently storing nothing.
    """
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise InvalidCoordinatesError(f"{field} requires both a latitude and a longitude")
    validate_coordinates(lat, lng)
    return from_shape(Point(lng, lat), srid=4326)


def _sanitize_proof(proof_data: dict | None, **kwargs: bool) -> dict | None:
    """Run the Tiptap sanitiser, mapping its ``ValueError`` to the typed 400."""
    if proof_data is None:
        return None
    try:
        return sanitize_tiptap_doc(proof_data, **kwargs)
    except ValueError as exc:
        raise InvalidProofError(str(exc)) from exc


def _require_submission_floor(tags: list[Tag], conflicts: list[Conflict]) -> None:
    """Enforce the curated floor: one conflict + one ``capture_source`` tag.

    Half of the evidence floor a row must clear to become ``geolocated``. A
    human create runs it up front; a request / machine detection is born
    bare and runs it at the geolocate transition. Checked against resolved
    ``Conflict`` / ``Tag`` rows, so a bogus id payload fails like an empty
    one. Both domains ship an escape value (the ``Other`` conflict, the
    ``Other`` capture source), so the rule is always satisfiable.
    """
    if not conflicts:
        raise TagRequirementsError("A conflict is required")
    if "capture_source" not in {t.category for t in tags}:
        raise TagRequirementsError("A capture source tag is required")


def _require_submission_media(has_media: bool) -> None:
    """Enforce the source floor: one source media on the row.

    The sibling of :func:`_require_submission_floor`, shared by every write
    (create, request, geolocate): an event never exists without its footage.
    """
    if not has_media:
        raise MediaRequiredError("A source media file is required")


@dataclass(frozen=True)
class SourceSwap:
    """What a write does to an event's source media: what it drops, what survives.

    The one place the source-media rules live, for the two writes that carry the
    fields (:func:`geolocate` and :func:`save_version`): the removal list names
    stored rows, ``files`` carries the replacement, and the two together have to
    leave the event on exactly one ``source`` media.
    """

    removed: list[Media]
    survivors: int


def _plan_source_swap(geo: Event, *, remove_media_ids: list, files: list[UploadFile]) -> SourceSwap:
    """Read a write's source-media fields against the row, before any S3 work.

    Ids arrive as JSON strings from the form, so the comparison is on the string
    form. Raises :class:`TooManyFilesError` (422) when kept plus new would leave
    the event on more than one source media: the row an upload replaces has to
    be named for removal in the same call, which is also what the
    ``uq_media_source_per_event`` index enforces at the database.

    The caller checks ``survivors`` against the floor
    (:func:`_require_submission_media`) and applies the removals with
    :func:`_apply_source_removals`, so a refused write touches nothing.
    """
    removing = {str(x) for x in remove_media_ids}
    sources = [m for m in geo.media if m.role == "source"]
    kept = [m for m in sources if str(m.id) not in removing]
    if len(kept) + len(files) > 1:
        raise TooManyFilesError(
            "An event carries a single source media; remove the current one to replace it"
        )
    return SourceSwap(
        removed=[m for m in sources if str(m.id) in removing],
        survivors=len(kept) + len(files),
    )


def _apply_source_removals(db: Session, swap: SourceSwap) -> None:
    """Delete the source rows a write drops, and flush the deletes.

    The flush is the load-bearing half: delete-then-insert has to reach Postgres
    in that order, or the replacement source trips
    ``uq_media_source_per_event`` mid-flush. Call it before the intake attaches
    the new file. What happens to the S3 objects is the caller's own call: a
    pre-publication swap sweeps them, while a version keeps them, since the
    snapshot it just filed renders that media.
    """
    for media in swap.removed:
        db.delete(media)
    db.flush()


def _require_proof_image(proof_doc: dict | None) -> None:
    """Enforce the proof-image floor: the proof body embeds at least one image.

    The third leg of the evidence floor at ``geolocated``: a vouched location
    without a visual argument isn't reviewable. Counts both already-uploaded
    URLs (the edit flow) and ``placeholder://`` srcs about to resolve.
    """
    if proof_doc is None or not extract_image_srcs(proof_doc):
        raise ProofImageRequiredError("At least one proof image is required")


# The proof-image leg as a Postgres jsonpath. Recursive descent over the
# document, matching any node typed ``image`` whose ``attrs.src`` is a string:
# the same verdict :func:`sanitize.extract_image_srcs` reaches by walking the
# tree in Python, on the same inputs. Both count a ``placeholder://`` src, which
# is the intake-time convention (see ``sanitize.PROOF_PLACEHOLDER_PREFIX``) and
# never survives into a persisted doc, so no prefix test is needed on either
# side. ``lax`` mode (the default) is what makes a node without ``attrs``, or
# with a non-string ``src``, fall out instead of raising.
_PROOF_IMAGE_JSONPATH = '$.** ? (@.type == "image" && @.attrs.src.type() == "string")'

# The queue filter values ``GET /events/detections`` accepts, ``all`` being no
# narrowing at all. Sibling of ``event_filters.VIEWS``: the router validates
# against it and answers 422 on anything else.
DETECTION_READINESS = frozenset({"all", "ready", "incomplete"})


def detection_ready_predicate() -> ColumnElement[bool]:
    """The publish floor of :func:`_publish_detection`, as one SQL predicate.

    A detection is *ready* when everything the analyst cannot supply
    from the review form's two picks is already on the row, leg for leg the
    checks :func:`_publish_detection` runs before it flips the status:

    1. a non-blank ``source_url``, there a ``strip()`` test, here non-NULL and
       holding a non-space character;
    2. ``event_coords`` present;
    3. a ``source`` media row, there a scan of the loaded collection, here an
       ``EXISTS``;
    4. :func:`_require_proof_image`, here :data:`_PROOF_IMAGE_JSONPATH`.

    The two remaining floor legs (a conflict, a ``capture_source`` tag) are the
    judgment the review supplies per row, so a detection missing them is still
    ready in this sense. That is the same line ``batchCompletionBlockers``
    (``frontend/src/lib/events.ts``) draws, and the three implementations are
    held to one verdict by ``tests/events/test_detections_readiness.py``.

    Every leg is strictly TRUE or FALSE (never NULL), so ``not_()`` of this is
    the exact complement and a row lands in ready or incomplete, never neither.
    """
    return and_(
        # ``NULL AND unknown`` is FALSE in SQL, so the NULL case can't leak
        # into the negation as unknown. ``[^[:space:]]`` is the SQL spelling of
        # Python's ``not source_url.strip()`` and of the frontend's
        # ``!source_url?.trim()``: blank means no non-space character.
        Event.source_url.isnot(None),
        Event.source_url.regexp_match("[^[:space:]]"),
        Event.event_coords.isnot(None),
        # ``.any()`` lowers to EXISTS, so a detection with several attachments is
        # not row-multiplied into the count.
        Event.media.any(Media.role == "source"),
        func.jsonb_path_exists(Event.proof, _PROOF_IMAGE_JSONPATH),
    )


def _resolve_tags(db: Session, tag_ids: list) -> list[Tag]:
    return db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []


def _resolve_conflicts(db: Session, conflict_ids: list) -> list[Conflict]:
    return db.query(Conflict).filter(Conflict.id.in_(conflict_ids)).all() if conflict_ids else []


def _credit_geolocator(db: Session, geo: Event, user: User) -> None:
    """Make ``user`` the owner of record and record durable geolocation credit.

    The one place that upholds the invariant "a ``geolocated`` event's
    ``owner_id`` is always among its ``event_geolocators``" (asserted on the
    model, and the basis for the GDPR-erasure floor in
    ``admin.hard_delete_user``). Every geolocation-producing path routes through
    here instead of hand-pairing the two writes, so a future transition can't set
    the owner and forget the credit. Idempotent on the credit row by its
    composite PK.
    """
    geo.owner_id = user.id
    db.add(EventGeolocator(event_id=geo.id, user_id=user.id))


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    capture_source_lat: float | None,
    capture_source_lng: float | None,
    source_url: str,
    secondary_source_urls: list[str],
    event_date: date | None,
    event_time: time | None = None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    file: UploadFile,
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Create a ``geolocated`` event row + its evidence (a direct geolocate).

    The router has already turned raw multipart fields into clean Python
    types; this deals only with business rules and IO. The row is born
    ``geolocated`` (the model's ``status`` server_default), stamped
    ``geolocated_at``, and the creator lands in ``event_geolocators`` (the
    durable credit the owner column alone doesn't carry).

    The full evidence floor applies: subject coordinates, exactly ONE source
    file, at least one proof image in the proof body (a ``placeholder://`` src
    resolved from ``proof_files``, see ``evidence_intake``), a conflict, and
    the curated ``capture_source`` tag. ``capture_source_lat`` / ``lng``
    (the camera point) are optional, both-or-neither.

    ``source_snapshot_url`` is the archived copy of ``source_url`` the analyst
    made while filling the form, and ``secondary_snapshot_urls`` carries the
    same per mirror, aligned with ``secondary_source_urls``: optional, checked
    by ``services/source_archive`` and stored as the event's archived copies in
    this same transaction, so a rejected paste (:class:`SnapshotRejected`,
    raised before any upload) creates no event.

    Failure modes (:class:`EvidenceIntakeError` subclasses, event rules
    here, shared file/media rules from ``evidence_intake``):

    * Out-of-range lat/lng (:class:`InvalidCoordinatesError`)
    * No source file (:class:`MediaRequiredError`)
    * Tiptap proof fails sanitisation (:class:`InvalidProofError`)
    * No proof image (:class:`ProofImageRequiredError`)
    * Missing required conflict / `capture_source` tag
      (:class:`TagRequirementsError`)
    * More secondary source links than the cap
      (:class:`TooManySourceLinksError`)
    * File type/size rejected, a proof placeholder/file mismatch, or the
      uploader raises (``InvalidFileError`` / ``ProofFilesMismatchError`` /
      ``EvidenceProcessingFailedError``)

    Any failure rolls back the transaction and best-effort sweeps every S3
    key that landed before it. Returns the persisted ``Event``,
    refreshed from the row.
    """
    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    # Paired off the raw list, before normalization renumbers it.
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, source_url)

    # Every event needs its footage: exactly one source file.
    _require_submission_media(file is not None)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # The rest of the floor, checked before any upload: a missing tag or an
    # image-less proof 400s without paying an S3 round-trip.
    _require_proof_image(proof_data)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    geo = Event(
        owner_id=current_user.id,
        title=title,
        event_coords=from_shape(Point(lng, lat), srid=4326),
        capture_source_coords=capture_point,
        source_url=source_url,
        # ``proof`` lands via the intake below (placeholders rewritten); the
        # model default keeps the column NOT NULL until then.
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        is_graphic=is_graphic,
        geolocated_at=datetime.now(UTC),
    )
    geo.tags = effective_tags
    geo.conflicts = effective_conflicts
    geo.source_links = build_source_link_rows(secondary_links)

    db.add(geo)
    db.flush()
    # Durable credit: the creator vouched this location. ``owner_id`` is already
    # on the row above; ``_credit_geolocator`` re-asserts it and adds the credit
    # row so the owner-among-geolocators invariant lives in one place.
    _credit_geolocator(db, geo, current_user)

    # The copies the analyst archived while filling the form, the source's and
    # the mirrors'. The rows need the event's id, so they are staged after the
    # flush, and still before the first upload: a rejected paste costs no S3
    # round-trip.
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=[file],
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context="event create rollback",
    )

    db.refresh(geo)
    points_cache.invalidate()
    return geo


async def create_request(
    db: Session,
    *,
    current_user: User,
    title: str,
    source_url: str,
    secondary_source_urls: list[str],
    proof_data: dict | None,
    lat: float | None = None,
    lng: float | None = None,
    capture_source_lat: float | None = None,
    capture_source_lng: float | None = None,
    event_date: date | None = None,
    event_time: time | None = None,
    source_posted_at: datetime,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    file: UploadFile,
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Create a ``requested`` event row + its source media (an open call).

    The router has already parsed the multipart form and rejected blank
    ``title`` / ``source_url`` and malformed JSON; this owns the business
    rules + IO. The row is born ``requested``, stamped ``requested_at``, with
    ``owner_id = requested_by_id = current_user`` so the poster keeps edit
    rights until a fulfiller takes over, and stays credited as the requester
    after.

    Coordinates are OPTIONAL (an approximate guess is allowed on a request,
    both-or-neither), as is the camera point. Tags are optional too: the
    geolocate transition enforces the curated floor. One source file is
    required: a request is an "unfinished geolocation", so the poster's
    evidence must be on the row from the start. The proof body MAY carry images
    (a request can be work started but not finished): they ride in
    ``proof_files`` and resolve against ``placeholder://`` srcs exactly like the
    geolocate path. Unlike a geolocation there is no proof-image floor, so a
    blank request stays imageless.

    ``source_snapshot_url`` and ``secondary_snapshot_urls`` are the archived
    copies of the declared links, on the same terms as
    :func:`create_with_evidence`: the poster archives them while filling the one
    form that posts either shape, so the pastes are kept whichever button they
    press.

    Failure modes: :class:`InvalidCoordinatesError` on a bad / half-typed
    guess, :class:`MediaRequiredError` with no file,
    :class:`InvalidProofError` on an unsanitisable proof,
    :class:`TooManySourceLinksError` past the secondary-link cap, plus the
    shared file-validation errors. Any failure rolls back and sweeps whatever
    landed.
    """
    guess_point = _optional_point(lat, lng, field="event_coords")
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, source_url)

    _require_submission_media(file is not None)

    # Allow optional inline proof images: the intake resolves ``placeholder://``
    # srcs from ``proof_files`` like the geolocate path. No ``_require_proof_image``
    # floor here, a request may be imageless.
    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    geo = Event(
        owner_id=current_user.id,
        # Preserved across fulfilment so the merge doesn't erase who opened the
        # request; ``owner_id`` transfers to the fulfiller, ``requested_by_id``
        # stays put.
        requested_by_id=current_user.id,
        title=title,
        event_coords=guess_point,
        capture_source_coords=capture_point,
        source_url=source_url,
        # ``proof`` lands via the intake below (placeholders rewritten) when
        # present; the model's empty-doc default keeps the column NOT NULL for a
        # blank request.
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        is_graphic=is_graphic,
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    geo.tags = _resolve_tags(db, tag_ids)
    geo.conflicts = _resolve_conflicts(db, conflict_ids)
    geo.source_links = build_source_link_rows(secondary_links)

    db.add(geo)
    db.flush()

    # Same placement as the direct create: after the flush that mints the id,
    # before the first upload.
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=[file],
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context="event request create rollback",
    )

    db.refresh(geo)
    return geo


async def geolocate(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    capture_source_lat: float | None,
    capture_source_lng: float | None,
    source_url: str,
    secondary_source_urls: list[str],
    event_date: date | None,
    event_time: time | None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    remove_media_ids: list,
    files: list[UploadFile],
    proof_files: list[UploadFile],
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
) -> Event:
    """Transition a ``requested`` or ``detected`` event to ``geolocated``.

    The one generalized "give this event a vouched location" write, folding
    request fulfilment and detection submit into a single step. The form posts
    the whole state (title, coordinates, source URL, event date + time, source
    post time, the graphic-content flag, proof + its images, tags, and the
    source media: ``files`` added, ``remove_media_ids`` dropped), and on
    success the row becomes ``geolocated``, stamped ``geolocated_at``, with the
    caller credited in ``event_geolocators``. From there it is corrected through
    :func:`save_version`, which files each superseded version; what publication
    fixes is the evidence anchor (``source_url`` and the source media), not the
    record. ``detected_from_url`` (the provenance anchor) and ``status`` carry
    no form field.

    ``is_graphic`` is the one field the form cannot lower: it ratchets, so a
    posted false leaves an already-flagged event flagged. Clearing it is
    admin-only, through ``PATCH /admin/events/{id}/moderation``.

    Concurrency: the row is re-fetched ``with_for_update()`` FIRST, then the
    status re-checked: two racing geolocates serialize on the row lock and
    the loser sees the 409, restoring the pre-merge fulfilment lock (see
    migration ``n0i2d4e6f8a0`` for the historic pattern). The
    ``uq_media_source_per_event`` index is the DB-level backstop.

    Permissions differ by the source state:

    * ``detected``: a machine detection, owner-only: ``current_user`` must be its
      ``owner_id`` (403 otherwise). It stays the owner.
    * ``requested``: an open call anyone may answer: ``owner_id`` (the
      edit-rights owner) transfers to ``current_user``, the fulfiller.
      ``requested_by_id`` is left as the original poster, so the merge preserves
      who asked.

    The field updates, media removals, new uploads, the owner transfer, and the
    state flip commit in a single transaction; a failed upload rolls everything
    back and sweeps the keys that landed (the removals revert with the txn, so
    their S3 stays). The removed media's S3 objects are swept after the commit
    succeeds. Removed-row deletes are flushed BEFORE the replacement source
    insert so the one-source partial unique index isn't tripped mid-flush.

    The evidence floor a direct create meets is enforced here, before any S3
    work, since a request / machine detection is born incomplete: a non-blank
    source URL (a detection may be born without one), exactly one
    source media (kept or new), at least one proof image in the final proof
    body, a conflict, and the curated ``capture_source`` tag.

    The secondary source links are NOT part of that frozen anchor: unlike
    ``source_url``, the submitted list replaces whatever the row held, on a
    requested fulfilment as well as an owner's detected submit. They are
    mirrors, not the evidence origin, so a fulfiller correcting them is an
    edit, not a rewrite of the requester's claim.

    ``source_snapshot_url`` is the archived copy of the stored source URL and
    ``secondary_snapshot_urls`` carries one per submitted mirror, the same
    fields the submit form carries: optional, checked by
    ``services/source_archive``, and stored in this transaction. Whether or not
    the form carries one, ``reconcile_source_archive`` runs, so an edit that
    changes the source URL never leaves a copy of the old one filed as the
    event's archived source (see that function for the drop-or-re-file rule).

    Raises :class:`EventStateError` (409) off ``requested`` / ``detected``,
    :class:`InvalidCoordinatesError` / :class:`InvalidProofError` (400) on bad
    values, :class:`SourceUrlRequiredError` / :class:`MediaRequiredError` /
    :class:`ProofImageRequiredError` / :class:`TooManySourceLinksError` /
    :class:`TagRequirementsError` (400) when the floor is unmet,
    :class:`TooManyFilesError` (422) past the one-source cap, or a
    file-validation error. Returns the refreshed ``geolocated`` row.
    """
    # Fulfilment lock FIRST: serialize on the row, then re-check the status
    # under the lock so a concurrent geolocate can't double-fulfil.
    # ``populate_existing()`` is load-bearing: the router already loaded this
    # row into the session identity map, so without it the locked SELECT reuses
    # that stale Python object and the loser reads a pre-lock ``status``,
    # double-fulfilling despite holding the lock.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    if geo.status not in (STATUS_REQUESTED, STATUS_DETECTED):
        raise EventStateError("Only requested or detected events can be geolocated")
    # A machine detection is owner-only; an open request is answerable by anyone
    # (they become the owner below). ``ensure_owner`` raises 403 on mismatch.
    if geo.status == STATUS_DETECTED:
        ensure_owner(geo, current_user)
    # A requested event's ``source_url`` is the requester's evidence anchor; a
    # fulfiller (anyone may answer an open request) must not rewrite it. Only the
    # owner's own detected submit may change it. Captured before ``status`` flips.
    keep_requester_source_url = geo.status == STATUS_REQUESTED

    # The source floor at promotion: a ``geolocated`` row always carries its
    # footage source. A detection may be born source-less, so the form
    # value (required but possibly blank) must be a real URL here; a requested
    # fulfilment keeps the requester's value, non-NULL by
    # ``ck_events_source_url_status``, checked all the same.
    effective_source_url = geo.source_url if keep_requester_source_url else source_url
    if effective_source_url is None or not effective_source_url.strip():
        raise SourceUrlRequiredError("A source URL is required to geolocate an event")

    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    # Normalized against the source URL that will actually be stored, so a
    # fulfiller who repeats the requester's anchor among the mirrors has it
    # dropped rather than stored twice.
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, effective_source_url)

    # Source accounting counts what survives the geolocate: kept existing +
    # new uploads must land on exactly one. The same read
    # :func:`save_version` runs, since one source-media rule serves both writes.
    swap = _plan_source_swap(geo, remove_media_ids=remove_media_ids, files=files)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # Evidence floor, checked up front (before any S3 upload) against the
    # post-geolocate state: one source survives, the final proof body carries
    # an image, and the conflict + curated tag are set.
    _require_submission_media(swap.survivors > 0)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    # Suppress autoflush across the transition: the ``geo.tags`` assignment
    # lazy-loads the current tags, which would flush the half-mutated row
    # before every stamp is set. The flush happens below, once every field is
    # consistent.
    with db.no_autoflush:
        geo.title = title
        geo.event_coords = from_shape(Point(lng, lat), srid=4326)
        geo.capture_source_coords = capture_point
        if not keep_requester_source_url:
            geo.source_url = source_url.strip()
        geo.event_date = event_date
        geo.event_time = event_time
        geo.source_posted_at = source_posted_at
        # A ratchet, unlike every other field here: the form raises the flag
        # and never lowers it, so a false value against an already-flagged
        # event leaves it set. Clearing is admin-only, through ``PATCH
        # /admin/events/{id}/moderation``, which audits the unmark. An author
        # who mis-flags their own event asks an admin to undo it.
        geo.is_graphic = geo.is_graphic or is_graphic
        geo.tags = effective_tags
        geo.conflicts = effective_conflicts
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
    # Fulfilling an open request hands edit-rights to the fulfiller (the original
    # poster stays on ``requested_by_id``) and records durable credit. Both go
    # through ``_credit_geolocator`` so the owner-among-geolocators invariant is
    # written in one place. Idempotent by PK; a first geolocate has no prior row.
    _credit_geolocator(db, geo, current_user)

    # The submitted mirrors replace the stored ones wholesale (see the
    # docstring: they carry none of ``source_url``'s requester protection).
    replace_source_links(db, geo, secondary_links)

    # Drop the source media flagged for removal: snapshot their S3 keys first,
    # since the rows go with the flush. Nothing versioned points at them (a row
    # publishing here is at version 1, with no snapshot behind it), so the
    # objects are swept once the commit lands.
    removed_keys = collect_media_keys(swap.removed)
    _apply_source_removals(db, swap)

    # The archived source follows the source URL this write stores: a copy of a
    # URL that is no longer the source is re-filed or dropped, and the paste the
    # form carried fills the slot. The mirrors' copies file against the links
    # ``replace_source_links`` just wrote, so a snapshot posted beside a mirror
    # this write dropped is dropped with it. All of it runs before the upload,
    # so a rejected paste costs no S3 round-trip, and inside this transaction,
    # so a failure takes it back with everything else.
    source_archive.reconcile_source_archive(db, event=geo)
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    # Upload new files + commit everything atomically; rollback-sweeps the new
    # uploads on failure. Empty ``files`` still commits the field + removal edits.
    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=files,
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} geolocate rollback",
    )

    # Committed; sweep the removed media's S3 objects (best-effort).
    sweep_keys(removed_keys, context=f"event {geo.id} geolocate media removal")
    db.refresh(geo)
    points_cache.invalidate()
    return geo


async def save_version(
    db: Session,
    *,
    geo: Event,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    capture_source_lat: float | None,
    capture_source_lng: float | None,
    source_url: str | None = None,
    secondary_source_urls: list[str],
    event_date: date | None,
    event_time: time | None,
    source_posted_at: datetime | None,
    proof_data: dict | None,
    tag_ids: list,
    conflict_ids: list,
    is_graphic: bool = False,
    remove_media_ids: list | None = None,
    files: list[UploadFile] | None = None,
    proof_files: list[UploadFile],
    note: str | None = None,
    source_snapshot_url: str | None = None,
    secondary_snapshot_urls: list[str] | None = None,
    detected_from_snapshot_url: str | None = None,
) -> Event:
    """Correct a published event, filing the superseded state as a version.

    Owner-only, and only on a ``geolocated`` row: before publication a row is
    still being written (a detection is machine output its owner submits, a
    request is an open call anyone answers), so there is no vouched version for
    an edit to supersede. The pre-edit state is snapshotted into
    ``event_versions`` at the current ``version_no``, the edit is applied, and
    the row takes the next number, all in one transaction under the same row
    lock :func:`close` and :func:`geolocate` take.

    **The evidence anchor is editable, and versioned.** ``source_url`` and the
    ``source`` media are what the published claim rests on, so a correction to
    either is filed like any other: the version this call supersedes carries the
    source URL and the whole render shape of the source media
    (``services/versions.build_snapshot``), and ``/vN`` shows what the claim
    rested on then. The import sometimes picks the wrong media out of a
    multi-media post, and a better copy of the same footage turns up later, so
    an owner who can correct a coordinate can correct the evidence it points at.
    The media moves on the same fields :func:`geolocate` takes,
    ``remove_media_ids`` dropping the stored row and ``files`` carrying the
    replacement, and the same one-source cap binds. ``source_url`` is optional
    here, like ``source_posted_at``: absent keeps what the row holds, and a
    blank value is refused rather than stored, since a ``geolocated`` row always
    carries a source (``ck_events_source_url_status``). Everything else the
    publish form wrote is editable and versioned too: title, both coordinate
    sets, the event date and hour, the source post time, the graphic-content
    flag, tags, conflicts, the proof body and its inline images, and the
    secondary source links.

    **The superseded source media keeps its S3 object.** An event carries at
    most one ``source`` row (``uq_media_source_per_event``), so a swap deletes
    the row it replaces; the snapshot filed by the same call describes that
    media whole, and the object it names is left in place, so the version stays
    renderable. What sweeps it is the event's own deletion
    (``evidence_intake.collect_event_media_keys``) or the redaction of the last
    version that named it (``evidence_intake.orphaned_source_keys``).

    ``source_posted_at`` is optional, matching what publication accepts: a
    detection whose source post time was never resolved publishes through
    :func:`_publish_detection` with the column NULL, so an edit of that row must
    be able to leave it NULL rather than be forced to invent an instant. ``None``
    therefore means "keep what the row holds": an owner who blanks the input
    leaves the stored instant alone, and only a parsed value replaces it.

    ``is_graphic`` ratchets exactly as on :func:`geolocate`: a posted false
    leaves an already-flagged event flagged, and only ``PATCH
    /admin/events/{id}/moderation`` clears it.

    ``source_snapshot_url`` records the archived copy of the source URL this
    write stores, ``detected_from_snapshot_url`` the copy of the post a machine
    detection came from (the one link no write here can move), and
    ``secondary_snapshot_urls`` one copy per submitted mirror. All three are
    staged after the version this edit supersedes is filed, so one call files
    one version and the new one carries the copies. A copy of a source URL this
    edit replaced is re-filed or dropped by ``reconcile_source_archive``, so no
    row claims to archive a source the event no longer declares. A mirror this write drops takes its stored
    copy with it (``source_archive.drop_mirror_archives``), since a copy filed
    against a link the event no longer declares archives nothing the record
    shows.

    The evidence floor a publication met is re-checked against the post-edit
    state, so an edit cannot drop a published row below it: a ``source`` media
    on the row, at least one proof image in the final proof body, a conflict,
    and the curated ``capture_source`` tag. Proof images ride in ``proof_files``
    and resolve against the doc's ``placeholder://`` srcs, exactly as on the
    publish forms; an image the new body drops is deleted only if no readable
    version displays it (see ``services/versions.referenced_media_urls``).

    **A version has to change something.** The incoming state is compared
    against the live row on the versioned fields
    (``services/versions.COMPARED_FIELDS``, plus the archived copies), and an
    edit that moves none of them raises :class:`NothingChangedError` before the
    version is filed and before any upload runs. A source-media swap is its own
    leg of that check: the incoming file has neither id nor URL until it lands,
    so what is compared is the swap itself, a removal or a new file being a
    change by construction.

    **A save that only archives is exempt from the version ceiling.** An event
    stops at ``MAX_VERSIONS_PER_EVENT`` versions, but a save whose only change
    is archived copies files its version regardless: preserving evidence is what
    the catalog is for, and a source that dies while the row sits at the ceiling
    would be unarchivable for good.

    Raises :class:`EventStateError` (409) off ``geolocated``, the 403 of
    ``ensure_owner`` for anyone but the owner, :class:`NothingChangedError`
    (409) on an edit that moves nothing,
    ``services/versions.VersionLimitError`` (409) on an edit to a row already at
    ``MAX_VERSIONS_PER_EVENT``, :class:`InvalidCoordinatesError` /
    :class:`InvalidProofError` / :class:`ProofImageRequiredError` /
    :class:`MediaRequiredError` / :class:`TagRequirementsError` /
    :class:`SourceUrlRequiredError` / :class:`TooManySourceLinksError` (400) on a
    bad value or an unmet floor, :class:`TooManyFilesError` (422) past the
    one-source cap, and the shared file-validation errors. Returns the refreshed
    row, one version further on.
    """
    # Same lock discipline as ``geolocate`` and ``close``: serialize on the row,
    # then re-read status and ownership under the lock. ``populate_existing()``
    # is what makes the re-read real, since the router already put this row in
    # the session identity map. Two concurrent edits therefore take their
    # ``version_no`` in a defined order rather than both snapshotting version N.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status != STATUS_GEOLOCATED:
        raise EventStateError("Only a geolocated event can be edited")

    files = files or []
    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")
    mirror_snapshots = pair_secondary_snapshots(
        secondary_source_urls, secondary_snapshot_urls or []
    )
    # An absent field keeps the stored source, the way ``source_posted_at``
    # keeps the stored instant; a blank one is refused, since a published row
    # always carries a source URL (``ck_events_source_url_status``).
    if source_url is not None and not source_url.strip():
        raise SourceUrlRequiredError("A source URL is required on a published event")
    effective_source_url = geo.source_url if source_url is None else source_url.strip()
    # Normalized against the source URL this write stores, so an owner who moves
    # the old source down to the mirrors while promoting one of them keeps one
    # link in one place rather than storing it twice.
    secondary_links = normalize_secondary_source_urls(secondary_source_urls, effective_source_url)

    # The source media this edit drops and what survives it, on the same rules
    # and the same cap :func:`geolocate` runs. Read before any S3 work, so a
    # refused swap files no version.
    swap = _plan_source_swap(geo, remove_media_ids=remove_media_ids or [], files=files)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # The published floor, re-checked before any S3 work against the post-edit
    # state: the source media that survives this write, not the one the row
    # arrived with, so an edit cannot leave a published record without footage.
    _require_submission_media(swap.survivors > 0)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    effective_conflicts = _resolve_conflicts(db, conflict_ids)
    _require_submission_floor(effective_tags, effective_conflicts)

    # An edit that moves nothing is refused before anything is staged. A version
    # spends a number in a public address space (``/events/{id}/vN``) and prints
    # a row in the history, so one carrying the state the live row already
    # carries tells a reader that a correction happened when none did. Compared
    # on the incoming values against the row under the lock, so a refused edit
    # files no version and uploads no file. The note is not part of the
    # comparison: it annotates a change, and on its own there is none to
    # annotate.
    proposed = {
        "title": title,
        "source_url": effective_source_url,
        "event_coords": {"lat": lat, "lng": lng},
        "capture_source_coords": versions.point_shape(capture_point),
        "event_date": event_date.isoformat() if event_date is not None else None,
        "event_time": event_time.isoformat() if event_time is not None else None,
        # ``None`` keeps what the row holds, so the proposed value is the stored
        # one; anything else is what the write would store.
        "source_posted_at": (
            source_posted_at.isoformat()
            if source_posted_at is not None
            else (geo.source_posted_at.isoformat() if geo.source_posted_at is not None else None)
        ),
        # Ratcheted, exactly as the write below ratchets it: a posted false on a
        # flagged row changes nothing.
        "is_graphic": geo.is_graphic or is_graphic,
        "secondary_source_urls": secondary_links,
        "tags": versions.tag_entries(effective_tags),
        "conflicts": versions.conflict_entries(effective_conflicts),
        "proof": proof_data if proof_data is not None else geo.proof,
    }
    # The archived copies are their own leg: a paste is a change only where it
    # differs from the copy that link already holds, and only for a link the
    # post-edit row still carries, since a paste beside a dropped mirror is
    # dropped with it. A dropped mirror is a change the list above already names.
    # The comparison runs through ``source_archive.same_snapshot``, the writer's
    # own fold, so a re-paste of the stored copy that picked up a trailing slash
    # on its way through a browser reads as the copy it is.
    stored_copies = versions.archived_pairs(geo)
    pasted_copies = {
        link: mirror_snapshots[link] for link in secondary_links if link in mirror_snapshots
    }
    if source_snapshot_url and effective_source_url is not None:
        pasted_copies[effective_source_url] = source_snapshot_url
    if detected_from_snapshot_url and geo.detected_from_url is not None:
        pasted_copies[geo.detected_from_url] = detected_from_snapshot_url
    copies_move = any(
        not source_archive.same_snapshot(stored_copies.get(link), snapshot)
        for link, snapshot in pasted_copies.items()
    )
    # Built once, here: the same object answers the no-change check and becomes
    # the filed snapshot below, so one save reads the row's collections once.
    current_snapshot = versions.build_snapshot(geo)
    # The source media is the one versioned field that cannot be compared as a
    # value: the incoming file has neither id nor URL until it lands, so the
    # swap itself is the verdict. Dropping the stored source or adding a file
    # moves the anchor, and nothing else can.
    media_move = bool(swap.removed or files)
    fields_move = media_move or not versions.matches_current(current_snapshot, proposed)
    if not fields_move and not copies_move:
        raise NothingChangedError(f"Nothing changed since version {geo.version_no}.")

    # File the version this edit supersedes BEFORE any field moves: the snapshot
    # reads the live collections, so it has to run against the pre-edit row. It
    # is also what protects that version's images from the intake's proof diff
    # below, which is why it is staged first: the diff reads the snapshots, this
    # one included, and keeps every image a readable version still displays.
    # The row becomes the next version in the same call, so the archived copy
    # staged further down lands in the new version rather than in the filed one.
    # The ceiling binds an edit and spares a save that only archives, so an
    # original dying at version 100 can still be preserved.
    versions.file_version(
        db,
        geo=geo,
        edited_by=current_user,
        note=note,
        snapshot=current_snapshot,
        enforce_ceiling=fields_move,
    )

    # Same autoflush suppression as ``geolocate``: the collection assignments
    # lazy-load the current sets, which would flush a half-edited row.
    with db.no_autoflush:
        geo.title = title
        # ``None`` keeps the stored source, so only a posted value replaces it.
        # The version filed above carries the URL it replaces, so the record
        # still shows what the claim rested on.
        if source_url is not None:
            geo.source_url = effective_source_url
        geo.event_coords = from_shape(Point(lng, lat), srid=4326)
        geo.capture_source_coords = capture_point
        geo.event_date = event_date
        geo.event_time = event_time
        # None means keep, never clear. The form posts the whole state and an
        # empty datetime input arrives indistinguishable from an absent field,
        # so assigning unconditionally wiped the stored instant of a published
        # record on an edit that never touched it.
        if source_posted_at is not None:
            geo.source_posted_at = source_posted_at
        geo.is_graphic = geo.is_graphic or is_graphic
        geo.tags = effective_tags
        geo.conflicts = effective_conflicts

    replace_source_links(db, geo, secondary_links)

    # A mirror this edit removed is gone from the event, so the copy filed
    # against it archives a link the record no longer declares. Dropped before
    # the pastes below and after ``file_version`` above, so the filed version
    # keeps the copies it held while the new one carries only live links.
    source_archive.drop_mirror_archives(db, event=geo, kept=secondary_links)

    # The archived source follows the source URL this write stores, exactly as
    # on ``geolocate``: a copy of a URL that is no longer the source is re-filed
    # against the link it still covers or dropped, and the paste below fills the
    # slot. The provenance link cannot move here, so nothing can strand its copy.
    source_archive.reconcile_source_archive(db, event=geo)

    # The archived copies of the source, of the immutable provenance link and of
    # the submitted mirrors, filed in this same transaction and after
    # ``file_version`` above, so they land in the version this edit produces
    # rather than in the one it supersedes.
    if source_snapshot_url:
        source_archive.stage_source_snapshot(db, event=geo, snapshot_url=source_snapshot_url)
    if detected_from_snapshot_url:
        source_archive.stage_detected_from_snapshot(
            db, event=geo, snapshot_url=detected_from_snapshot_url
        )
    source_archive.stage_secondary_snapshots(db, event=geo, snapshots=mirror_snapshots)

    # Drop the source media this edit replaces, flushed before the intake
    # inserts the new one (delete-then-insert, or the one-source index trips
    # mid-flush). Their S3 objects are NOT swept: the version filed above
    # renders that media, and the snapshot is the only thing describing it once
    # the row is gone.
    _apply_source_removals(db, swap)

    # The new source media (0 or 1) rides in with the proof body's new images,
    # and the whole write commits atomically.
    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=files,
        proof_doc=proof_data,
        proof_files=proof_files,
        sweep_context=f"event {geo.id} save_version rollback",
    )

    db.refresh(geo)
    # The coordinates may have moved, so the map's point cache is stale.
    points_cache.invalidate()
    return geo


# The one per-row code that is not a floor verdict: a database failure on that
# row, caught so it cannot take the rest of the batch down with it. Published as
# part of the contract (``docs/api.md``) because a client has to be able to tell
# "this detection is incomplete" from "retry this detection".
ROW_INTERNAL_ERROR_CODE = "internal_error"


@dataclass(frozen=True)
class DetectionCompletion:
    """One row's outcome in a batch completion.

    ``code`` is ``None`` on a published row and the failing
    :class:`EventError`'s stable code otherwise (or
    :data:`ROW_INTERNAL_ERROR_CODE` on a database failure), with ``message`` the
    human sentence the queue renders next to that row. A failed row is
    untouched: it stays a detection its owner can finish by hand.
    """

    event_id: uuid.UUID
    code: str | None = None
    message: str | None = None


def _assert_owns_all(db: Session, *, event_ids: list[uuid.UUID], current_user: User) -> None:
    """403 the whole call if any targeted row belongs to someone else.

    Run before the first row commits, so a batch that reaches for another
    analyst's detection publishes nothing. Ownership is the one condition treated
    this way: the ids come from the caller's own queue, so a foreign one is a
    broken client rather than a row-level data problem, and the per-row results
    stay about the evidence floor. A row that no longer exists is NOT an
    ownership failure; the loop reports it per row.
    """
    for row in (
        db.query(Event.id, Event.owner_id)
        .filter(Event.id.in_(event_ids), Event.deleted_at.is_(None))
        .all()
    ):
        ensure_owner(row, current_user)


def _publish_detection(
    db: Session,
    *,
    event_id: uuid.UUID,
    current_user: User,
    capture_source_tag: Tag | None,
    conflicts: list[Conflict],
) -> None:
    """Promote one detection to ``geolocated`` on the evidence it
    already carries plus the two judgment calls the batch supplies.

    The completion counterpart of :func:`geolocate`: no field edits, no uploads,
    no proof rewrite. Everything the floor needs beyond the conflict and the
    capture-source tag is what the import already put on the row, so the whole
    transition is a tag write plus the state flip. It runs the SAME floor
    helpers as the single-row transition (:func:`_require_submission_media`,
    :func:`_require_proof_image`, :func:`_require_submission_floor`), which is
    the point: a batch must not be a second, looser door to ``geolocated``.

    Locked with ``with_for_update()`` + ``populate_existing()`` like
    :func:`geolocate`, so a batch racing a hand-submit of the same detection
    serializes and the loser sees the state error. Commits on success.

    The floor below is also what the detections queue filters on, projected
    into SQL by :func:`detection_ready_predicate`: change a leg here and change it
    there.

    Raises the typed floor errors, :class:`EventStateError` off ``detected``,
    :class:`EventNotFoundError` when the row is gone, and the 403 of
    :func:`ensure_owner` on a row the caller does not own. The caller rolls back
    and records the code against the row.
    """
    geo = (
        db.query(Event)
        # A withheld detection is frozen for its owner (same as the single-row
        # :func:`geolocate`, which resolves through ``_resolve_live_event``):
        # while an admin holds a row down, its owner does not get to move it on
        # to a published state.
        .filter(Event.id == event_id, *visible_events())
        .populate_existing()
        .with_for_update()
        .first()
    )
    if geo is None:
        raise EventNotFoundError("This detection no longer exists")
    # Re-checked here, not only in ``complete_detections``: the helper owns the
    # whole promotion, so it must be safe to call from a future entry point.
    ensure_owner(geo, current_user)
    if geo.status != STATUS_DETECTED:
        raise EventStateError("Only a detection can be completed in a batch")

    # The floor, in the order that puts the cheapest read first. Each miss is a
    # row the analyst has to open by hand, so the message names what to fix.
    if geo.source_url is None or not geo.source_url.strip():
        raise SourceUrlRequiredError("A source URL is required to geolocate an event")
    if geo.event_coords is None:
        raise CoordinatesRequiredError("This detection carries no coordinates")
    _require_submission_media(any(m.role == "source" for m in geo.media))
    # The proof-image leg: satisfied already when the import carried annotation
    # media, and the reason a row drops out of the batch when it did not.
    _require_proof_image(geo.proof)
    if capture_source_tag is None:
        raise TagRequirementsError("A capture source tag is required")

    # The batch sets exactly one capture source per row, so an imported one is
    # replaced rather than added to; every other tag the detection carries survives.
    effective_tags = [t for t in geo.tags if t.category != "capture_source"]
    effective_tags.append(capture_source_tag)
    _require_submission_floor(effective_tags, conflicts)

    # Same autoflush suppression as ``geolocate``: the collection assignments
    # lazy-load the current sets, which would flush a half-stamped row.
    with db.no_autoflush:
        geo.tags = effective_tags
        geo.conflicts = conflicts
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
    _credit_geolocator(db, geo, current_user)
    db.commit()
    db.refresh(geo)


def complete_detections(
    db: Session,
    *,
    current_user: User,
    conflict_ids: list[uuid.UUID],
    rows: list[tuple[uuid.UUID, uuid.UUID]],
) -> list[DetectionCompletion]:
    """Publish a selection of detections in one call, row by row.

    The batch shape the import queue needs: an import is usually dominated by
    one conflict, so ``conflict_ids`` is set once for the whole selection, while
    the capture source varies detection to detection and rides per row (``rows`` is
    ordered ``(event_id, capture_source_tag_id)`` pairs). Everything else the
    floor demands is already on the row, which is what makes publishing an
    import cost one dropdown per detection instead of a form.

    One transaction PER ROW, deliberately: a detection that fails the floor rolls
    back alone and stays a detection, and the rest of the selection still publishes.
    The result list mirrors ``rows`` order, one :class:`DetectionCompletion` each.

    Two conditions fail the whole call instead, both before anything commits: an
    empty / unresolvable ``conflict_ids`` (:class:`TagRequirementsError`, since
    no row could clear the floor), and a row owned by someone else (403 from
    ``ensure_owner``). Nothing after the first commit can fail the call: a
    database error on one row is caught and reported as
    :data:`ROW_INTERNAL_ERROR_CODE` against that row.
    """
    conflicts = _resolve_conflicts(db, conflict_ids)
    if not conflicts:
        raise TagRequirementsError("A conflict is required")
    _assert_owns_all(db, event_ids=[event_id for event_id, _ in rows], current_user=current_user)

    # The selection draws its capture sources from one small curated set, so
    # resolve the distinct ids once rather than per row. A tag id that resolves
    # to nothing (or to a non-``capture_source`` tag) fails its own rows on the
    # floor, not the call.
    tags_by_id = {tag.id: tag for tag in _resolve_tags(db, list({tag_id for _, tag_id in rows}))}

    outcomes: list[DetectionCompletion] = []
    published = 0
    for event_id, tag_id in rows:
        try:
            _publish_detection(
                db,
                event_id=event_id,
                current_user=current_user,
                capture_source_tag=tags_by_id.get(tag_id),
                conflicts=conflicts,
            )
        # The shared base, not ``EventError``: the media floor raises
        # ``evidence_intake``'s own ``MediaRequiredError``, which is a sibling
        # rather than a subclass, and it must land on its row like any other
        # floor miss.
        except EvidenceIntakeError as exc:
            db.rollback()
            outcomes.append(DetectionCompletion(event_id=event_id, code=exc.code, message=str(exc)))
            continue
        # Per-row isolation has to cover the unexpected too. A database failure
        # escaping here would 500 the whole call and throw away the verdicts of
        # every row already published, which is the one outcome the batch shape
        # exists to prevent. Logged with the row, reported as its own verdict.
        except SQLAlchemyError:
            db.rollback()
            logger.exception("batch completion failed on event %s", event_id)
            outcomes.append(
                DetectionCompletion(
                    event_id=event_id,
                    code=ROW_INTERNAL_ERROR_CODE,
                    message="This detection could not be published; try it again.",
                )
            )
            continue
        published += 1
        outcomes.append(DetectionCompletion(event_id=event_id))

    if published:
        points_cache.invalidate()
    return outcomes


def close(db: Session, *, geo: Event, current_user: User, close_reason: str) -> Event:
    """Close an event: withdraw, reject or retract it, in one verb.

    Owner-only, and available in all three live states.
    ``before_closed_status`` records which one the row left, so the badge, the
    read views and detection re-import can tell them apart:

    * off ``requested``, a withdrawn call for help.
    * off ``detected``, a rejected machine detection. It stays in the located
      catalog as an audit row and stays re-importable
      (see ``detection._row_disposition``).
    * off ``geolocated``, a public retraction of published work. The page stays
      readable and keeps its id, coordinate, credits, archives and version
      history, with the reason beside the closed badge; it leaves the published
      set, the feeds and the map (``event_filters.published_events`` and
      ``view_predicate``), and no machine touches it again.

    The row stays publicly visible in every case: a record that says why it was
    taken back is what a retraction is. Nothing here reopens a closed row, which
    is why the reason is required; removing a row for good is the admin delete.

    Raises :class:`EventStateError` (409) on a ``closed`` row, the terminal
    state. Commits, invalidates the points cache, returns the refreshed row.
    """
    # Serialize on the row like ``geolocate`` and ``save_version``: a
    # ``requested`` event is fulfillable by anyone, so a concurrent geolocate (a
    # different actor) could otherwise be silently overwritten by this close
    # reading a stale in-memory status, and a concurrent correction of a
    # published row must file its version either wholly before or wholly after
    # the retraction. ``populate_existing`` refreshes the identity-mapped row
    # from the freshly locked SELECT before the owner and status re-checks.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status == STATUS_CLOSED:
        raise EventStateError("This event is already closed")
    # Sound cast: the guard above pins status to the BeforeClosedStatus domain.
    geo.before_closed_status = cast(BeforeClosedStatus, geo.status)
    geo.status = STATUS_CLOSED
    geo.closed_at = datetime.now(UTC)
    geo.close_reason = close_reason
    db.commit()
    db.refresh(geo)
    points_cache.invalidate()
    return geo
