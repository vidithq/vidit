"""Requested-view (bounty) orchestration over the unified event model.

A bounty is a ``Geolocation`` with ``status='requested'``: an open call to
geolocate, with evidence media but no coordinates yet.
`routers/bounties.py::create_bounty` parses the multipart form into clean
Python types and hands them to `create_with_evidence`, which owns the business
rules, tag resolution, and the shared evidence-intake tail
(`services/evidence_intake.py`): the file-count cap, per-file validation, the S3
upload loop with key tracking, the DB commit, and the post-rollback S3 sweep.
Same shape `routers/geolocations/*` delegate to `services/geolocations.py`; both
consume the one helper rather than mirroring the orchestration.

Errors are typed `EvidenceIntakeError` subclasses (shared file/media
failure modes) plus `BountyError` for requested-view rules, both carrying
stable `.code` strings translated to HTTP via the `{code, message}`
envelope in `routers/bounties.py`.
"""

from __future__ import annotations

from datetime import date, datetime, time

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.models.geolocation import STATUS_REQUESTED, Geolocation
from app.models.tag import Tag
from app.models.user import User
from app.services.evidence_intake import (
    EvidenceIntakeError,
    MediaRequiredError,
    attach_media_and_commit,
    enforce_file_count,
)
from app.services.sanitize import EMPTY_TIPTAP_DOC, sanitize_tiptap_doc
from app.services.storage import upload_file


class BountyError(EvidenceIntakeError):
    """Base for requested-view-specific friendly errors.

    Subclass of :class:`EvidenceIntakeError` so the router catches one base
    for both shared file/media failures and the requested-view rules.
    """

    code = "bounty_error"


class InvalidProofError(BountyError):
    code = "invalid_proof"


async def create_with_evidence(
    db: Session,
    *,
    current_user: User,
    title: str,
    source_url: str,
    proof_data: dict | None,
    event_date: date | None = None,
    event_time: time | None = None,
    source_posted_at: datetime,
    tag_ids: list,
    files: list[UploadFile],
    uploaded_ip: str | None,
    uploaded_user_agent: str | None,
) -> Geolocation:
    """Create a ``requested`` event row + its media.

    The router has already parsed the multipart form into clean Python
    types and rejected blank ``title`` / ``source_url`` and malformed JSON;
    this owns the business rules + IO. The row is born ``requested`` with no
    location (``location`` NULL), and ``requested_by_id`` set to the poster so
    the merge preserves who asked when the event is later fulfilled.

    Failure modes (:class:`EvidenceIntakeError` subclasses):

    * ``len(files) > MAX_FILES_PER_SUBMISSION`` (``TooManyFilesError``)
    * No files (:class:`MediaRequiredError`) — a requested event is an
      "unfinished geolocation", so the poster's evidence must be on the row
      from the start.
    * ``proof`` fails Tiptap sanitisation
      (:class:`InvalidProofError`)
    * File type/size rejected, or the uploader raises
      ``EvidenceProcessingError`` (``InvalidFileError`` /
      ``EvidenceProcessingFailedError``)

    Any failure rolls back the transaction and best-effort sweeps every S3
    key that landed. Returns the persisted ``Geolocation``, refreshed from the
    row.
    """
    enforce_file_count(files)
    if not files:
        raise MediaRequiredError("At least one media file is required")

    if proof_data is not None:
        try:
            # allow_images=False: a requested event's proof is image-free. Inline
            # images would never be adopted into proof_images (that table only
            # links a geolocation the fulfilment reuses), so they're dropped
            # rather than stored broken.
            proof_data = sanitize_tiptap_doc(proof_data, allow_images=False)
        except ValueError as exc:
            raise InvalidProofError(str(exc)) from exc

    geo = Geolocation(
        author_id=current_user.id,
        # Preserved across fulfilment so the merge doesn't erase who opened the
        # request; ``author_id`` transfers to the fulfiller, ``requested_by_id``
        # stays put.
        requested_by_id=current_user.id,
        title=title,
        source_url=source_url,
        # NOT NULL: a request with no proof body stores the empty doc, not NULL.
        proof=proof_data if proof_data is not None else EMPTY_TIPTAP_DOC,
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        status=STATUS_REQUESTED,
    )
    if tag_ids:
        geo.tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all()

    db.add(geo)
    db.flush()

    await attach_media_and_commit(
        db,
        owner_id=geo.id,
        files=files,
        upload=upload_file,
        uploaded_ip=uploaded_ip,
        uploaded_user_agent=uploaded_user_agent,
        sweep_context="bounty create rollback",
    )

    db.refresh(geo)
    return geo
