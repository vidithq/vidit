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
from datetime import UTC, date, datetime

from fastapi import UploadFile
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.orm import Session, joinedload

from app.cache import points_cache
from app.config import settings
from app.models.bounty import STATUS_FULFILLED, STATUS_OPEN, Bounty
from app.models.geolocation import Geolocation
from app.models.media import Media
from app.models.proof_image import ProofImage
from app.models.tag import Tag
from app.models.user import User
from app.services.evidence_processing import EvidenceProcessingError
from app.services.sanitize import extract_image_srcs, sanitize_tiptap_doc
from app.services.storage import (
    get_storage,
    safe_original_filename,
    sweep_keys,
    upload_file,
    validate_file,
)

MAX_FILES_PER_GEOLOCATION = settings.max_files_per_geolocation


class GeolocationError(Exception):
    """Base for friendly errors raised by the geolocations service.

    Carries a ``code`` so the router maps to an HTTP status without
    string-matching exception text. Mirrors
    :class:`app.services.admin.AdminError` and
    :class:`app.services.registration.RegistrationError`.
    """

    code: str = "geolocation_error"


class InvalidCoordinatesError(GeolocationError):
    code = "invalid_coordinates"


class TooManyFilesError(GeolocationError):
    code = "too_many_files"


class MediaRequiredError(GeolocationError):
    code = "media_required"


class InvalidProofError(GeolocationError):
    code = "invalid_proof"


class TagRequirementsError(GeolocationError):
    code = "tag_requirements_not_met"


class InvalidFileError(GeolocationError):
    code = "invalid_file"


class EvidenceProcessingFailedError(GeolocationError):
    code = "evidence_processing_failed"


class BountyNotFoundError(GeolocationError):
    code = "bounty_not_found"


class BountyNotOpenError(GeolocationError):
    code = "bounty_not_open"


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    source_url: str,
    event_date: date,
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

    Failure modes (all :class:`GeolocationError` subclasses):

    * Out-of-range lat/lng (:class:`InvalidCoordinatesError`)
    * ``len(files) > MAX_FILES_PER_GEOLOCATION`` (:class:`TooManyFilesError`)
    * No files and no bounty-media to inherit (:class:`MediaRequiredError`)
    * Tiptap proof fails sanitisation (:class:`InvalidProofError`)
    * Missing required `conflict` / `capture_source` tag
      (:class:`TagRequirementsError`)
    * File type/size rejected by ``validate_file``
      (:class:`InvalidFileError`)
    * ``upload_file`` raises ``EvidenceProcessingError``
      (:class:`EvidenceProcessingFailedError`)
    * Bounty id doesn't resolve or is soft-deleted
      (:class:`BountyNotFoundError`)
    * Bounty status != ``open`` (:class:`BountyNotOpenError`)

    Any failure rolls back the transaction and best-effort sweeps every S3
    key that landed before it (:func:`sweep_keys`). Returns the persisted
    ``Geolocation``, refreshed from the row.
    """
    if not -90 <= lat <= 90:
        raise InvalidCoordinatesError("Latitude must be between -90 and 90")
    if not -180 <= lng <= 180:
        raise InvalidCoordinatesError("Longitude must be between -180 and 180")

    if len(files) > MAX_FILES_PER_GEOLOCATION:
        raise TooManyFilesError(f"At most {MAX_FILES_PER_GEOLOCATION} files per submission")

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

    # Require at least one ``conflict`` and one ``capture_source`` tag.
    # Both selectors are required on the submit form (each ships an escape
    # value), so the rule is always satisfiable incl. via bounty fulfilment.
    # Checked against the *resolved* tags' categories so a bogus tag_ids
    # payload is rejected like an empty one. Runs before any upload.
    tag_categories = {t.category for t in effective_tags}
    if "conflict" not in tag_categories:
        raise TagRequirementsError("A conflict tag is required")
    if "capture_source" not in tag_categories:
        raise TagRequirementsError("A capture source tag is required")

    # When fulfilling, `source_url` comes from the bounty row, never the
    # form: it's the EVIDENCE LINK the bounty was opened against, so a
    # fulfilling analyst can't swap in proof from an unrelated event.
    # ``title`` / ``tag_ids`` stay form-sourced (the bounty keeps its own).
    geo = Geolocation(
        author_id=current_user.id,
        title=title,
        location=from_shape(Point(lng, lat), srid=4326),
        source_url=bounty.source_url if bounty is not None else source_url,
        proof=proof_data,
        event_date=event_date,
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

    # Validate every file before any upload — a 400 on file #3 shouldn't
    # strand files #1 and #2 in S3.
    media_types: list[str] = []
    for file in files:
        try:
            media_types.append(validate_file(file))
        except ValueError as exc:
            raise InvalidFileError(str(exc)) from exc

    # Track uploaded S3 keys so a mid-batch failure can sweep them on
    # rollback — otherwise file #1 lands, file #2 throws, the txn rolls
    # back, and file #1 is a chronic S3 orphan.
    uploaded_keys: list[str] = []
    try:
        for file, media_type in zip(files, media_types, strict=True):
            try:
                result = await upload_file(file, geo.id)
            except EvidenceProcessingError as exc:
                raise EvidenceProcessingFailedError(str(exc)) from exc
            media = Media(
                geolocation_id=geo.id,
                storage_url=result.url,
                media_type=media_type,
                sha256=result.sha256,
                uploaded_ip=uploaded_ip,
                uploaded_user_agent=uploaded_user_agent,
                original_filename=safe_original_filename(file.filename),
            )
            db.add(media)
            key = get_storage().key_from_url(result.url)
            if key is not None:
                uploaded_keys.append(key)
                # Sweep hero + thumbnail derivatives alongside the original
                # on row-side failure — same shape as routers/bounties.py.
                uploaded_keys.extend(result.derivative_keys)

        # Adopt inline proof images owned by the current user and not yet
        # claimed. Inside the try so an UPDATE failure routes through the
        # same orphan-cleanup path.
        if proof_data is not None:
            srcs = extract_image_srcs(proof_data)
            if srcs:
                storage = get_storage()
                keys = [k for k in (storage.key_from_url(s) for s in srcs) if k is not None]
                if keys:
                    db.query(ProofImage).filter(
                        ProofImage.s3_key.in_(keys),
                        ProofImage.user_id == current_user.id,
                        ProofImage.geolocation_id.is_(None),
                    ).update(
                        {ProofImage.geolocation_id: geo.id},
                        synchronize_session=False,
                    )

        # Commit inside the try so a commit-time failure (FK violation,
        # serialization conflict, PG network blip) also routes through the
        # orphan cleanup; wrapping only the upload loop stranded S3 objects
        # on commit failure.
        db.commit()
    except Exception:
        # Explicit rollback (mirrors routers/bounties.py): don't rely on
        # ``get_db``'s ``finally``, since partially-added Media rows could
        # be autoflushed by any query a downstream error handler / metrics
        # middleware runs.
        db.rollback()
        sweep_keys(uploaded_keys, context="geolocation create rollback")
        raise

    db.refresh(geo)
    points_cache.invalidate()
    return geo
