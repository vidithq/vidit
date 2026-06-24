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
from app.models.bounty import STATUS_FULFILLED, STATUS_OPEN, Bounty
from app.models.geolocation import Geolocation
from app.models.media import Media
from app.models.proof_image import ProofImage
from app.models.tag import Tag
from app.models.user import User
from app.services.evidence_intake import (
    EvidenceIntakeError,
    MediaRequiredError,
    attach_media_and_commit,
    enforce_file_count,
)
from app.services.sanitize import EMPTY_TIPTAP_DOC, extract_image_srcs, sanitize_tiptap_doc
from app.services.storage import get_storage, upload_file


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


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    lat: float,
    lng: float,
    source_url: str,
    event_date: date,
    source_date: date | None = None,
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
    if not -90 <= lat <= 90:
        raise InvalidCoordinatesError("Latitude must be between -90 and 90")
    if not -180 <= lng <= 180:
        raise InvalidCoordinatesError("Longitude must be between -180 and 180")

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
        # NOT NULL: a submission with no proof body stores the empty doc, not
        # NULL. ``proof_data`` stays None for the inline-image adoption below.
        proof=proof_data if proof_data is not None else EMPTY_TIPTAP_DOC,
        event_date=event_date,
        source_date=source_date,
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
