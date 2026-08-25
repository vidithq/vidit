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

from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import (
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.user import User
from app.services import source_archive, versions
from app.services.evidence_intake import attach_evidence_and_commit, collect_media_keys
from app.services.permissions import ensure_owner
from app.services.storage import sweep_keys

from .batch import ROW_INTERNAL_ERROR_CODE, DetectionCompletion, complete_detections
from .close import close
from .coordinates import _optional_point, validate_coordinates
from .errors import (
    CoordinatesRequiredError,
    EventError,
    EventNotFoundError,
    EventStateError,
    InvalidCoordinatesError,
    InvalidProofError,
    NothingChangedError,
    ProofImageRequiredError,
    SourceUrlRequiredError,
    TagRequirementsError,
    TooManySourceLinksError,
)
from .rules import (
    DETECTION_READINESS,
    SourceSwap,
    _apply_source_removals,
    _credit_geolocator,
    _plan_source_swap,
    _require_proof_image,
    _require_submission_floor,
    _require_submission_media,
    _resolve_conflicts,
    _resolve_tags,
    _sanitize_proof,
    detection_ready_predicate,
)
from .source_links import (
    build_source_link_rows,
    normalize_secondary_source_urls,
    pair_secondary_snapshots,
    replace_source_links,
    truncate_secondary_source_urls,
)

__all__ = [
    "DETECTION_READINESS",
    "ROW_INTERNAL_ERROR_CODE",
    "CoordinatesRequiredError",
    "DetectionCompletion",
    "EventError",
    "EventNotFoundError",
    "EventStateError",
    "InvalidCoordinatesError",
    "InvalidProofError",
    "NothingChangedError",
    "ProofImageRequiredError",
    "SourceSwap",
    "SourceUrlRequiredError",
    "TagRequirementsError",
    "TooManySourceLinksError",
    "build_source_link_rows",
    "close",
    "complete_detections",
    "create_request",
    "create_with_evidence",
    "detection_ready_predicate",
    "geolocate",
    "normalize_secondary_source_urls",
    "pair_secondary_snapshots",
    "replace_source_links",
    "save_version",
    "truncate_secondary_source_urls",
    "validate_coordinates",
]


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
    :func:`save_version`, which files each superseded version, the evidence
    anchor (``source_url`` and the source media) included. What publication
    fixes is ``detected_from_url``, the provenance anchor, which along with
    ``status`` carries no form field.

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

    The secondary source links replace whatever the row held, wholesale, on a
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
    here, like ``source_posted_at``: omitted or empty keeps what the row holds,
    and a whitespace-only value is refused rather than stored, since a
    ``geolocated`` row always carries a source (``ck_events_source_url_status``). Everything else the
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
    version that named it (``evidence_intake.orphaned_source_media``).

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
    # keeps the stored instant, and the router hands an empty form value over as
    # an absent one, so a form posting the field blank keeps it too. A
    # whitespace-only value is refused rather than stored, since a published row
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
