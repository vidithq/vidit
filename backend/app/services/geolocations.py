"""Geolocation creation orchestration.

`routers/geolocations.py::create_geolocation` parses the multipart form
into clean Python types and hands them to `create_with_evidence`, which
owns every business rule, the S3 upload loop, the bounty-fulfilment
cascade, inline-proof-image adoption, the DB commit, and the post-commit
S3 sweep on rollback.

Errors are typed `GeolocationError` subclasses with stable `.code`
strings, translated to HTTP via the same `{code, message}` envelope as
`RegistrationError` / `AdminError`. Status mapping lives in
`routers/geolocations.py` (`_GEOLOCATION_ERROR_STATUS`) — keep in sync
when adding a code.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session, joinedload

from app.cache import points_cache
from app.models.bounty import STATUS_FULFILLED, STATUS_OPEN, Bounty
from app.models.geolocation import STATE_DETECTED, STATE_SUBMITTED, Geolocation
from app.models.media import Media
from app.models.proof_image import ProofImage
from app.models.tag import Tag
from app.models.user import User
from app.services.evidence_intake import (
    MAX_FILES_PER_SUBMISSION,
    EvidenceIntakeError,
    MediaRequiredError,
    TooManyFilesError,
    attach_media_and_commit,
    enforce_file_count,
)
from app.services.sanitize import EMPTY_TIPTAP_DOC, extract_image_srcs, sanitize_tiptap_doc
from app.services.storage import derivative_key, get_storage, sweep_keys, upload_file


class GeolocationError(EvidenceIntakeError):
    """Base for geolocation-specific friendly errors.

    Subclass of :class:`EvidenceIntakeError` so the router catches one base
    for both shared file/media failures and the geolocation-specific rules
    below. Carries a ``code`` the router maps to an HTTP status without
    string-matching exception text.
    """

    code: str = "geolocation_error"


class InvalidCoordinatesError(GeolocationError):
    code = "invalid_coordinates"


class InvalidProofError(GeolocationError):
    code = "invalid_proof"


class TagRequirementsError(GeolocationError):
    code = "tag_requirements_not_met"


class BountyNotFoundError(GeolocationError):
    code = "bounty_not_found"


class BountyNotOpenError(GeolocationError):
    code = "bounty_not_open"


class GeolocationStateError(GeolocationError):
    """The geolocation's lifecycle state forbids the requested transition.

    Raised when an edit / validate / reject targets a row that isn't
    ``detected`` (a ``human`` row is frozen). Maps to 409 — the request is
    well-formed but conflicts with the row's current state.
    """

    code = "invalid_state"


def validate_coordinates(lat: float, lng: float) -> None:
    """Reject out-of-range coordinates — the single bounds check shared by the
    human create + edit paths."""
    if not -90 <= lat <= 90:
        raise InvalidCoordinatesError("Latitude must be between -90 and 90")
    if not -180 <= lng <= 180:
        raise InvalidCoordinatesError("Longitude must be between -180 and 180")


def _require_submission_tags(tags: list[Tag]) -> None:
    """Enforce the curated-tag floor: one ``conflict`` + one ``capture_source``.

    Shared by the two paths a geolocation reaches a publishable state. A human
    submit runs it at create; a machine ``detected`` row is born tagless and
    runs it at validate — the owner adds the tags during review. Checked
    against resolved ``Tag`` rows, so a bogus id payload fails like an empty
    one. Both categories ship an escape value, so the rule is always
    satisfiable.
    """
    categories = {t.category for t in tags}
    if "conflict" not in categories:
        raise TagRequirementsError("A conflict tag is required")
    if "capture_source" not in categories:
        raise TagRequirementsError("A capture source tag is required")


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    source_url: str,
    event_date: date,
    event_time: time | None = None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    bounty_id: uuid.UUID | None,
    files: list[UploadFile],
    uploaded_ip: str | None,
    uploaded_user_agent: str | None,
) -> Geolocation:
    """Create a geolocation row + its media, optionally fulfilling a bounty.

    The router has already turned raw multipart fields into clean Python
    types; this deals only with business rules and IO.

    Failure modes (:class:`EvidenceIntakeError` subclasses — geolocation
    rules here, shared file/media rules from ``evidence_intake``):

    * Out-of-range lat/lng (:class:`InvalidCoordinatesError`)
    * ``len(files) > MAX_FILES_PER_SUBMISSION`` (``TooManyFilesError``)
    * No files and no bounty-media to inherit (:class:`MediaRequiredError`)
    * Tiptap proof fails sanitisation (:class:`InvalidProofError`)
    * Missing required `conflict` / `capture_source` tag
      (:class:`TagRequirementsError`)
    * File type/size rejected, or the uploader raises
      ``EvidenceProcessingError`` (``InvalidFileError`` /
      ``EvidenceProcessingFailedError``)
    * Bounty id doesn't resolve or is soft-deleted
      (:class:`BountyNotFoundError`)
    * Bounty status != ``open`` (:class:`BountyNotOpenError`)

    Any failure rolls back the transaction and best-effort sweeps every S3
    key that landed before it. Returns the persisted ``Geolocation``,
    refreshed from the row.
    """
    validate_coordinates(lat, lng)

    enforce_file_count(files)

    bounty: Bounty | None = None
    if bounty_id is not None:
        # SELECT ... FOR UPDATE serialises concurrent fulfilments of the
        # same bounty. ``of=Bounty`` scopes the lock so the joinedload LEFT
        # JOINs against media/tags aren't locked too.
        bounty = (
            db.query(Bounty)
            .options(joinedload(Bounty.media), joinedload(Bounty.tags))
            .filter(Bounty.id == bounty_id, Bounty.deleted_at.is_(None))
            .with_for_update(of=Bounty)
            .first()
        )
        if bounty is None:
            raise BountyNotFoundError("Bounty not found")
        if bounty.status != STATUS_OPEN:
            raise BountyNotOpenError(f"Cannot fulfill a bounty with status {bounty.status}")

    # Every geolocation needs at least one media: a fresh upload batch, or
    # a fulfilled bounty's existing media (transferred in place, no S3
    # round-trip).
    if not files and not (bounty and bounty.media):
        raise MediaRequiredError("At least one media file is required")

    if proof_data is not None:
        try:
            proof_data = sanitize_tiptap_doc(proof_data)
        except ValueError as exc:
            raise InvalidProofError(str(exc)) from exc

    effective_tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []

    # Curated-tag floor (one conflict + one capture_source), satisfiable incl.
    # via bounty fulfilment. Runs before any upload — a missing/free-tag-only
    # selection 400s without paying an S3 round-trip. Same rule the detection
    # validate path enforces; see ``_require_submission_tags``.
    _require_submission_tags(effective_tags)

    # When fulfilling, `source_url` comes from the bounty row, never the
    # form: it's the EVIDENCE LINK the bounty was opened against, so a
    # fulfilling analyst can't swap in proof from an unrelated event.
    # ``title`` / ``tag_ids`` stay form-sourced (the bounty keeps its own).
    geo = Geolocation(
        author_id=current_user.id,
        title=title,
        location=from_shape(Point(lng, lat), srid=4326),
        source_url=bounty.source_url if bounty is not None else source_url,
        # NOT NULL: a submission with no proof body stores the empty doc, not
        # NULL. ``proof_data`` stays None for the inline-image adoption below.
        proof=proof_data if proof_data is not None else EMPTY_TIPTAP_DOC,
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        originated_from_bounty_id=bounty.id if bounty else None,
    )

    if effective_tags:
        geo.tags = effective_tags

    db.add(geo)
    db.flush()

    # Transfer bounty media in place — rewrite ``bounty_id → NULL,
    # geolocation_id → :geo`` on the existing rows; the S3 keys stay put.
    # Same transaction flips bounty status, so the lifecycle move is atomic
    # with the geo insert.
    if bounty is not None:
        db.query(Media).filter(Media.bounty_id == bounty.id).update(
            {Media.bounty_id: None, Media.geolocation_id: geo.id},
            synchronize_session=False,
        )
        bounty.status = STATUS_FULFILLED
        bounty.closed_at = datetime.now(UTC)

    def _adopt_inline_proof_images() -> None:
        # Adopt inline proof images owned by the current user and not yet
        # claimed. Runs inside ``attach_media_and_commit``'s try, before the
        # commit, so an UPDATE failure routes through the same orphan sweep.
        if proof_data is None:
            return
        srcs = extract_image_srcs(proof_data)
        if not srcs:
            return
        storage = get_storage()
        keys = [k for k in (storage.key_from_url(s) for s in srcs) if k is not None]
        if not keys:
            return
        db.query(ProofImage).filter(
            ProofImage.s3_key.in_(keys),
            ProofImage.user_id == current_user.id,
            ProofImage.geolocation_id.is_(None),
        ).update(
            {ProofImage.geolocation_id: geo.id},
            synchronize_session=False,
        )

    await attach_media_and_commit(
        db,
        owner_id=geo.id,
        fk_field="geolocation_id",
        files=files,
        upload=upload_file,
        uploaded_ip=uploaded_ip,
        uploaded_user_agent=uploaded_user_agent,
        sweep_context="geolocation create rollback",
        before_commit=_adopt_inline_proof_images,
    )

    db.refresh(geo)
    points_cache.invalidate()
    return geo


async def submit_detected(
    db: Session,
    *,
    geo: Geolocation,
    title: str,
    lat: float,
    lng: float,
    source_url: str,
    event_date: date,
    event_time: time | None,
    source_posted_at: datetime,
    proof_data: dict | None,
    tag_ids: list,
    remove_media_ids: list,
    files: list[UploadFile],
    uploaded_ip: str | None,
    uploaded_user_agent: str | None,
) -> Geolocation:
    """Submit a ``detected`` geolocation: write the owner's edits and flip it to
    ``submitted`` in one atomic step.

    A ``detected`` row is immutable machine output; this submit is the only write
    to it. Mirrors :func:`create_with_evidence`: the form posts the whole state
    (title, coordinate, source URL, event date + time, source post time, proof,
    tags, and source media: new ``files`` added, ``remove_media_ids`` dropped),
    and on success the row becomes ``submitted`` and frozen. ``detected_from_url``
    (the provenance anchor) and ``state`` carry no form field.

    The field updates, media removals, new uploads, and the state flip commit in a
    single transaction; a failed upload rolls everything back and sweeps the keys
    that landed (the removals revert with the txn, so their S3 stays). The removed
    media's S3 objects are swept after the commit succeeds.

    The evidence floor a human submit meets at create is enforced here, before any
    S3 work, since machine detections are born tagless: at least one media (kept +
    new) and the curated ``conflict`` + ``capture_source`` tags.

    Raises :class:`GeolocationStateError` (409) off ``detected``,
    :class:`InvalidCoordinatesError` / :class:`InvalidProofError` (400) on bad
    values, :class:`MediaRequiredError` / :class:`TagRequirementsError` (400) when
    the floor is unmet, :class:`TooManyFilesError` over the file-count cap, or a
    file-validation error. Returns the refreshed ``submitted`` row.
    """
    if geo.state != STATE_DETECTED:
        raise GeolocationStateError("Only detected geolocations can be submitted")

    validate_coordinates(lat, lng)

    # File-count cap counts what survives the submit: kept existing + new uploads.
    # Compare on the string form; ids arrive as JSON strings from the form.
    removing = {str(x) for x in remove_media_ids}
    kept = [m for m in geo.media if str(m.id) not in removing]
    if len(kept) + len(files) > MAX_FILES_PER_SUBMISSION:
        raise TooManyFilesError(f"At most {MAX_FILES_PER_SUBMISSION} files per geolocation")

    if proof_data is not None:
        try:
            proof_data = sanitize_tiptap_doc(proof_data)
        except ValueError as exc:
            raise InvalidProofError(str(exc)) from exc

    effective_tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all() if tag_ids else []

    # Evidence floor, checked up front (before any S3 upload) against the
    # post-submit state: at least one media survives, and both curated tags are set.
    if len(kept) + len(files) == 0:
        raise MediaRequiredError("At least one media file is required")
    _require_submission_tags(effective_tags)

    geo.title = title
    geo.location = from_shape(Point(lng, lat), srid=4326)
    geo.source_url = source_url
    geo.event_date = event_date
    geo.event_time = event_time
    geo.source_posted_at = source_posted_at
    if proof_data is not None:
        geo.proof = proof_data
    geo.tags = effective_tags
    geo.state = STATE_SUBMITTED

    # Drop the media flagged for removal: snapshot their S3 keys, delete the rows
    # (pending; committed atomically with the field updates + uploads below).
    storage = get_storage()
    removed_keys: list[str] = []
    for m in list(geo.media):
        if str(m.id) not in removing:
            continue
        key = storage.key_from_url(m.storage_url)
        if key is not None:
            removed_keys.append(key)
            if m.media_type == "image":
                removed_keys.append(derivative_key(key, "hero"))
                removed_keys.append(derivative_key(key, "thumb"))
        db.delete(m)

    # Upload new files + commit everything atomically; rollback-sweeps the new
    # uploads on failure. Empty ``files`` still commits the field + removal edits.
    await attach_media_and_commit(
        db,
        owner_id=geo.id,
        fk_field="geolocation_id",
        files=files,
        upload=upload_file,
        uploaded_ip=uploaded_ip,
        uploaded_user_agent=uploaded_user_agent,
        sweep_context=f"geolocation {geo.id} submit rollback",
    )

    # Committed; sweep the removed media's S3 objects (best-effort).
    sweep_keys(removed_keys, context=f"geolocation {geo.id} submit media removal")
    db.refresh(geo)
    points_cache.invalidate()
    return geo


def reject_detected(db: Session, *, geo: Geolocation) -> None:
    """Soft-delete a ``detected`` row — the owner rejects the detection.

    Sets ``deleted_at`` rather than hard-deleting: re-importing the same tweet
    later recreates it as a fresh ``detected`` (the assemble step's ``recreate``
    verdict matches a soft-deleted pair — see ``detection._disposition``). A
    ``human`` row is not rejectable here; the hard ``DELETE`` endpoint owns
    removing a row the owner already stood behind.

    Raises :class:`GeolocationStateError` (409) off ``detected``. Commits,
    invalidates the points cache.
    """
    if geo.state != STATE_DETECTED:
        raise GeolocationStateError("Only detected geolocations can be rejected")
    geo.deleted_at = datetime.now(UTC)
    db.commit()
    points_cache.invalidate()
