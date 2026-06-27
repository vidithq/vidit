"""Bounty creation orchestration.

`routers/bounties.py::create_bounty` parses the multipart form into clean
Python types and hands them to `create_with_evidence`, which owns the
business rules, tag resolution, and the shared evidence-intake tail
(`services/evidence_intake.py`): the file-count cap, per-file validation,
the S3 upload loop with key tracking, the DB commit, and the post-rollback
S3 sweep. Same shape `routers/geolocations.py` delegates to
`services/geolocations.py` — both consume one helper instead of mirroring
the orchestration.

Errors are typed `EvidenceIntakeError` subclasses (shared file/media
failure modes) plus `BountyError` for bounty-specific rules, both carrying
stable `.code` strings translated to HTTP via the `{code, message}`
envelope in `routers/bounties.py`.
"""

from __future__ import annotations

from datetime import date, datetime, time

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.models.bounty import STATUS_OPEN, Bounty
from app.models.tag import Tag
from app.models.user import User
from app.services.evidence_intake import (
    EvidenceIntakeError,
    MediaRequiredError,
    attach_media_and_commit,
    enforce_file_count,
)
from app.services.sanitize import sanitize_tiptap_doc
from app.services.storage import upload_bounty_file


class BountyError(EvidenceIntakeError):
    """Base for bounty-specific friendly errors.

    Subclass of :class:`EvidenceIntakeError` so the router catches one base
    for both shared file/media failures and the bounty-specific rules.
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
) -> Bounty:
    """Create a bounty row + its media.

    The router has already parsed the multipart form into clean Python
    types and rejected blank ``title`` / ``source_url`` and malformed JSON;
    this owns the business rules + IO.

    Failure modes (:class:`EvidenceIntakeError` subclasses):

    * ``len(files) > MAX_FILES_PER_SUBMISSION`` (``TooManyFilesError``)
    * No files (:class:`MediaRequiredError`) — a bounty is an "unfinished
      geolocation", so the poster's evidence must be on the row from the
      start.
    * ``proof`` fails Tiptap sanitisation
      (:class:`InvalidProofError`)
    * File type/size rejected, or the uploader raises
      ``EvidenceProcessingError`` (``InvalidFileError`` /
      ``EvidenceProcessingFailedError``)

    Any failure rolls back the transaction and best-effort sweeps every S3
    key that landed. Returns the persisted ``Bounty``, refreshed from the
    row.
    """
    enforce_file_count(files)
    if not files:
        raise MediaRequiredError("At least one media file is required")

    if proof_data is not None:
        try:
            # allow_images=False: a bounty's proof is image-free. Inline images
            # would never be adopted into proof_images (no bounty_id there) and
            # would orphan, so they're dropped rather than stored broken.
            proof_data = sanitize_tiptap_doc(proof_data, allow_images=False)
        except ValueError as exc:
            raise InvalidProofError(str(exc)) from exc

    bounty = Bounty(
        author_id=current_user.id,
        title=title,
        source_url=source_url,
        proof=proof_data,
        event_date=event_date,
        event_time=event_time,
        source_posted_at=source_posted_at,
        status=STATUS_OPEN,
    )
    if tag_ids:
        bounty.tags = db.query(Tag).filter(Tag.id.in_(tag_ids)).all()

    db.add(bounty)
    db.flush()

    await attach_media_and_commit(
        db,
        owner_id=bounty.id,
        fk_field="bounty_id",
        files=files,
        upload=upload_bounty_file,
        uploaded_ip=uploaded_ip,
        uploaded_user_agent=uploaded_user_agent,
        sweep_context="bounty create rollback",
    )

    db.refresh(bounty)
    return bounty
