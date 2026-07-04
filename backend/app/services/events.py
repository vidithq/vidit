"""Event lifecycle orchestration over the unified event model.

`routers/events/*` parse the multipart forms into clean Python types and
hand them to the functions here, which own every business rule, the S3 upload
loop, proof-image intake, the DB commit, and the post-commit S3 sweep on
rollback. The write verbs map one-to-one onto the lifecycle:
:func:`create_with_evidence` births a ``geolocated`` row, :func:`create_request`
a ``requested`` one, :func:`geolocate` is the one generalized transition to
``geolocated`` (fulfil a request, vouch a detection), and :func:`close` is the
terminal withdraw / reject.

Errors are typed `EventError` subclasses with stable `.code`
strings, translated to HTTP via the same `{code, message}` envelope as
`RegistrationError` / `AdminError`. Status mapping lives in
`routers/events/_common.py` (`_EVENT_ERROR_STATUS`), kept in sync
when adding a code.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import cast

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.cache import points_cache
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    BeforeClosedStatus,
    Event,
    EventGeolocator,
    EventInvestigator,
)
from app.models.tag import Tag
from app.models.user import User
from app.services.evidence_intake import (
    EvidenceIntakeError,
    MediaRequiredError,
    TooManyFilesError,
    attach_evidence_and_commit,
    collect_media_keys,
)
from app.services.permissions import ensure_owner
from app.services.sanitize import (
    EMPTY_TIPTAP_DOC,
    extract_image_srcs,
    sanitize_tiptap_doc,
)
from app.services.storage import sweep_keys


class EventError(EvidenceIntakeError):
    """Base for event-specific friendly errors.

    Subclass of :class:`EvidenceIntakeError` so the router catches one base
    for both shared file/media failures and the event-specific rules
    below. Carries a ``code`` the router maps to an HTTP status without
    string-matching exception text.
    """

    code: str = "event_error"


class InvalidCoordinatesError(EventError):
    code = "invalid_coordinates"


class InvalidProofError(EventError):
    code = "invalid_proof"


class TagRequirementsError(EventError):
    code = "tag_requirements_not_met"


class ProofImageRequiredError(EventError):
    code = "proof_image_required"


class EventStateError(EventError):
    """The event's lifecycle state forbids the requested transition.

    Raised when a geolocate targets a row that isn't ``requested`` /
    ``detected`` (a ``geolocated`` row is frozen, ``closed`` is terminal), or a
    close targets a row already past those states. Maps to 409: the request is
    well-formed but conflicts with the row's current state.
    """

    code = "invalid_state"


def validate_coordinates(lat: float, lng: float) -> None:
    """Reject out-of-range coordinates: the single bounds check shared by the
    human create + geolocate paths."""
    if not -90 <= lat <= 90:
        raise InvalidCoordinatesError("Latitude must be between -90 and 90")
    if not -180 <= lng <= 180:
        raise InvalidCoordinatesError("Longitude must be between -180 and 180")


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


def _require_submission_tags(tags: list[Tag]) -> None:
    """Enforce the curated-tag floor: one ``conflict`` + one ``capture_source``.

    Half of the evidence floor a row must clear to become ``geolocated``. A
    human create runs it up front; a request / machine detection is born
    tagless and runs it at the geolocate transition. Checked against resolved
    ``Tag`` rows, so a bogus id payload fails like an empty one. Both categories
    ship an escape value, so the rule is always satisfiable.
    """
    categories = {t.category for t in tags}
    if "conflict" not in categories:
        raise TagRequirementsError("A conflict tag is required")
    if "capture_source" not in categories:
        raise TagRequirementsError("A capture source tag is required")


def _require_submission_media(has_media: bool) -> None:
    """Enforce the source floor: one source media on the row.

    The sibling of :func:`_require_submission_tags`, shared by every write
    (create, request, geolocate): an event never exists without its footage.
    """
    if not has_media:
        raise MediaRequiredError("A source media file is required")


def _require_proof_image(proof_doc: dict | None) -> None:
    """Enforce the proof-image floor: the proof body embeds at least one image.

    The third leg of the evidence floor at ``geolocated``: a vouched location
    without a visual argument isn't reviewable. Counts both already-uploaded
    URLs (the edit flow) and ``placeholder://`` srcs about to resolve.
    """
    if proof_doc is None or not extract_image_srcs(proof_doc):
        raise ProofImageRequiredError("At least one proof image is required")


def _resolve_tags(db: Session, tag_ids: list) -> list[Tag]:
    return db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []


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
    event_date: date,
    event_time: time | None = None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    file: UploadFile,
    proof_files: list[UploadFile],
) -> Event:
    """Create a ``geolocated`` event row + its evidence (a direct geolocate).

    The router has already turned raw multipart fields into clean Python
    types; this deals only with business rules and IO. The row is born
    ``geolocated`` (the model's ``status`` server_default), stamped
    ``geolocated_at``, and the creator lands in ``event_geolocators`` (the
    durable credit the owner column alone doesn't carry).

    The full evidence floor applies: subject coordinates, exactly ONE source
    file, at least one proof image in the proof body (a ``placeholder://`` src
    resolved from ``proof_files``, see ``evidence_intake``), and the curated
    ``conflict`` + ``capture_source`` tags. ``capture_source_lat`` / ``lng``
    (the camera point) are optional, both-or-neither.

    Failure modes (:class:`EvidenceIntakeError` subclasses, event rules
    here, shared file/media rules from ``evidence_intake``):

    * Out-of-range lat/lng (:class:`InvalidCoordinatesError`)
    * No source file (:class:`MediaRequiredError`)
    * Tiptap proof fails sanitisation (:class:`InvalidProofError`)
    * No proof image (:class:`ProofImageRequiredError`)
    * Missing required `conflict` / `capture_source` tag
      (:class:`TagRequirementsError`)
    * File type/size rejected, a proof placeholder/file mismatch, or the
      uploader raises (``InvalidFileError`` / ``ProofFilesMismatchError`` /
      ``EvidenceProcessingFailedError``)

    Any failure rolls back the transaction and best-effort sweeps every S3
    key that landed before it. Returns the persisted ``Event``,
    refreshed from the row.
    """
    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")

    # Every event needs its footage: exactly one source file.
    _require_submission_media(file is not None)

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # The rest of the floor, checked before any upload: a missing tag or an
    # image-less proof 400s without paying an S3 round-trip.
    _require_proof_image(proof_data)
    effective_tags = _resolve_tags(db, tag_ids)
    _require_submission_tags(effective_tags)

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
        geolocated_at=datetime.now(UTC),
    )
    geo.tags = effective_tags

    db.add(geo)
    db.flush()
    # Durable credit: the creator vouched this location. ``owner_id`` is already
    # on the row above; ``_credit_geolocator`` re-asserts it and adds the credit
    # row so the owner-among-geolocators invariant lives in one place.
    _credit_geolocator(db, geo, current_user)

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
    proof_data: dict | None,
    lat: float | None = None,
    lng: float | None = None,
    capture_source_lat: float | None = None,
    capture_source_lng: float | None = None,
    event_date: date | None = None,
    event_time: time | None = None,
    source_posted_at: datetime,
    tag_ids: list,
    file: UploadFile,
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
    evidence must be on the row from the start. The proof body is image-free
    (there are no ``proof_files`` on this path; inline images are dropped by
    the sanitiser).

    Failure modes: :class:`InvalidCoordinatesError` on a bad / half-typed
    guess, :class:`MediaRequiredError` with no file,
    :class:`InvalidProofError` on an unsanitisable proof, plus the shared
    file-validation errors. Any failure rolls back and sweeps whatever landed.
    """
    guess_point = _optional_point(lat, lng, field="event_coords")
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")

    _require_submission_media(file is not None)

    proof_data = _sanitize_proof(proof_data, allow_images=False)

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
        # NOT NULL: a request with no proof body stores the empty doc, not NULL.
        proof=proof_data if proof_data is not None else EMPTY_TIPTAP_DOC,
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    geo.tags = _resolve_tags(db, tag_ids)

    db.add(geo)
    db.flush()

    await attach_evidence_and_commit(
        db,
        event=geo,
        source_files=[file],
        proof_doc=None,
        proof_files=[],
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
    event_date: date,
    event_time: time | None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    remove_media_ids: list,
    files: list[UploadFile],
    proof_files: list[UploadFile],
) -> Event:
    """Transition a ``requested`` or ``detected`` event to ``geolocated``.

    The one generalized "give this event a vouched location" write, folding
    bounty fulfilment and detection submit into a single step. The form posts
    the whole state (title, coordinates, source URL, event date + time, source
    post time, proof + its images, tags, and the source media: ``files`` added,
    ``remove_media_ids`` dropped), and on success the row becomes
    ``geolocated`` and frozen, stamped ``geolocated_at``, with the caller
    credited in ``event_geolocators``. ``detected_from_url`` (the provenance
    anchor) and ``status`` carry no form field.

    Concurrency: the row is re-fetched ``with_for_update()`` FIRST, then the
    status re-checked: two racing geolocates serialize on the row lock and
    the loser sees the 409, restoring the pre-merge fulfilment lock (see
    migration ``n0i2d4e6f8a0`` for the historic pattern). The
    ``uq_media_source_per_event`` index is the DB-level backstop.

    Permissions differ by the source state:

    * ``detected``: a machine draft, owner-only: ``current_user`` must be its
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
    work, since a request / machine detection is born incomplete: exactly one
    source media (kept or new), at least one proof image in the final proof
    body, and the curated ``conflict`` + ``capture_source`` tags.

    Raises :class:`EventStateError` (409) off ``requested`` / ``detected``,
    :class:`InvalidCoordinatesError` / :class:`InvalidProofError` (400) on bad
    values, :class:`MediaRequiredError` / :class:`ProofImageRequiredError` /
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

    validate_coordinates(lat, lng)
    capture_point = _optional_point(capture_source_lat, capture_source_lng, field="capture_source")

    # Source accounting counts what survives the geolocate: kept existing +
    # new uploads must land on exactly one. Compare on the string form; ids
    # arrive as JSON strings from the form.
    removing = {str(x) for x in remove_media_ids}
    kept = [m for m in geo.media if m.role == "source" and str(m.id) not in removing]
    if len(kept) + len(files) > 1:
        raise TooManyFilesError(
            "An event carries a single source media; remove the current one to replace it"
        )

    proof_data = _sanitize_proof(proof_data, allow_placeholders=True)

    # Evidence floor, checked up front (before any S3 upload) against the
    # post-geolocate state: one source survives, the final proof body carries
    # an image, and both curated tags are set.
    _require_submission_media(len(kept) + len(files) > 0)
    _require_proof_image(proof_data if proof_data is not None else geo.proof)
    effective_tags = _resolve_tags(db, tag_ids)
    _require_submission_tags(effective_tags)

    # Suppress autoflush across the transition: the ``geo.tags`` assignment
    # lazy-loads the current tags, which would flush the half-mutated row
    # before every stamp is set. The flush happens below, once every field is
    # consistent.
    with db.no_autoflush:
        geo.title = title
        geo.event_coords = from_shape(Point(lng, lat), srid=4326)
        geo.capture_source_coords = capture_point
        if not keep_requester_source_url:
            geo.source_url = source_url
        geo.event_date = event_date
        geo.event_time = event_time
        geo.source_posted_at = source_posted_at
        geo.tags = effective_tags
        geo.status = STATUS_GEOLOCATED
        geo.geolocated_at = datetime.now(UTC)
    # Fulfilling an open request hands edit-rights to the fulfiller (the original
    # poster stays on ``requested_by_id``) and records durable credit. Both go
    # through ``_credit_geolocator`` so the owner-among-geolocators invariant is
    # written in one place. Idempotent by PK; a first geolocate has no prior row.
    _credit_geolocator(db, geo, current_user)

    # Drop the source media flagged for removal: snapshot their S3 keys, delete
    # the rows, and FLUSH the deletes so the replacement insert below can't
    # trip ``uq_media_source_per_event`` mid-flush (delete-then-insert must
    # reach Postgres in that order).
    removed_rows = [m for m in geo.media if m.role == "source" and str(m.id) in removing]
    removed_keys = collect_media_keys(removed_rows)
    for m in removed_rows:
        db.delete(m)
    db.flush()

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


def close(db: Session, *, geo: Event, current_user: User, close_reason: str) -> Event:
    """Close an event: withdraw a request or reject a detection, in one verb.

    Owner-only. The row stays publicly visible (transparency: the queue tried
    and didn't produce a geolocation, or a machine draft was judged wrong).
    ``before_closed_status`` records which state it left so the badge, the
    requested-view routing, and detection re-import can tell the two apart. A
    closed detection is re-importable (see ``detection._disposition``);
    removing a row for good is the hard ``DELETE``.

    Raises :class:`EventStateError` (409) off ``requested`` / ``detected``
    (``geolocated`` is frozen, ``closed`` is terminal). Commits, invalidates
    the points cache, returns the refreshed row.
    """
    # Serialize on the row like ``geolocate``: a ``requested`` event is
    # fulfillable by anyone, so a concurrent geolocate (a different actor) could
    # otherwise be silently overwritten by this owner-only close reading a stale
    # in-memory status. ``populate_existing`` refreshes the identity-mapped row
    # from the freshly locked SELECT before the owner and status re-checks.
    geo = db.query(Event).filter(Event.id == geo.id).populate_existing().with_for_update().one()
    ensure_owner(geo, current_user)
    if geo.status not in (STATUS_REQUESTED, STATUS_DETECTED):
        raise EventStateError("Only requested or detected events can be closed")
    # Sound cast: the guard above pins status to the BeforeClosedStatus domain.
    geo.before_closed_status = cast(BeforeClosedStatus, geo.status)
    geo.status = STATUS_CLOSED
    geo.closed_at = datetime.now(UTC)
    geo.close_reason = close_reason
    db.commit()
    db.refresh(geo)
    points_cache.invalidate()
    return geo


def investigate(db: Session, *, geo: Event, current_user: User) -> None:
    """Record a public "I'm working on this" signal. Idempotent: re-signalling
    is a no-op, not a conflict. Only an open ``requested`` event accepts a
    signal; off ``requested`` it raises :class:`EventStateError` (409).

    The ``EventInvestigator`` composite PK ``(event_id, user_id)`` is the race
    backstop: two concurrent signals both pass the friendly-path SELECT, only one
    wins the INSERT, and the SAVEPOINT turns the loser's ``IntegrityError`` into
    the idempotent no-op instead of a 500. Mirrors ``services/social.follow_user``.
    """
    if geo.status != STATUS_REQUESTED:
        raise EventStateError(f"Cannot investigate an event with status {geo.status}")
    existing = (
        db.query(EventInvestigator)
        .filter(
            EventInvestigator.event_id == geo.id,
            EventInvestigator.user_id == current_user.id,
        )
        .first()
    )
    if existing is not None:
        return
    try:
        with db.begin_nested():
            db.add(EventInvestigator(event_id=geo.id, user_id=current_user.id))
    except IntegrityError:
        # Loser of the race: the row already exists, which IS the post-condition.
        pass
    db.commit()


def uninvestigate(db: Session, *, geo: Event, current_user: User) -> None:
    """Drop the caller's investigate signal. Idempotent: a no-op when the caller
    wasn't signalling (the post-condition is "caller not in the working set", not
    "exactly one row deleted"). Gated to ``requested`` like :func:`investigate`:
    a terminated event's signals are frozen history.
    """
    if geo.status != STATUS_REQUESTED:
        raise EventStateError(f"Cannot investigate an event with status {geo.status}")
    db.query(EventInvestigator).filter(
        EventInvestigator.event_id == geo.id,
        EventInvestigator.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
