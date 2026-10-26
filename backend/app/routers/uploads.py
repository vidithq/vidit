"""``POST /uploads``: stage one source file before the event write that names it."""

import asyncio
import logging

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.upload import Upload
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.source import LinkUploadRead, UploadFromLink, UploadRead
from app.services import uploads as uploads_service
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError
from app.services.storage import scrub_log

logger = logging.getLogger(__name__)
router = APIRouter()

_ERROR_STATUS = {**EVIDENCE_INTAKE_ERROR_STATUS, **uploads_service.UPLOAD_ERROR_STATUS}


def _upload_read(row: Upload) -> UploadRead:
    return UploadRead(
        id=row.id,
        kind=row.kind,
        sha256=row.sha256,
        original_filename=row.original_filename,
        storage_url=uploads_service.storage_url_of(row),
        expires_at=row.expires_at,
    )


@router.post("", response_model=UploadRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_upload(
    request: Request,
    # One file per request: the request size limit admits one video.
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UploadRead:
    """Stage one source file; a source of a later event write names it by ``id``.

    The file is validated (type, size) and stored now, and the row expires
    after 24 hours unless a write takes it. 400 on an invalid file, 429 past
    the per-account ceiling of staged files.
    """
    try:
        row = asyncio.run(uploads_service.stage_upload(db, uploader=current_user, file=file))
    except EvidenceIntakeError as exc:
        raise_typed_error(exc, _ERROR_STATUS)
    return _upload_read(row)


# ``def`` plus ``asyncio.run``, as ``import-from-tweet``: the chase and the download block.
@router.post("/from-link", response_model=LinkUploadRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_upload_from_link(
    request: Request,
    body: UploadFromLink,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LinkUploadRead:
    """Stage the file of a post link, as ``POST /uploads`` stages a picked one."""
    try:
        row, post_media = asyncio.run(
            uploads_service.stage_from_link(
                db, uploader=current_user, url=body.url, index=body.index
            )
        )
    except EvidenceIntakeError as exc:
        if exc.code == "upstream_busy":
            logger.warning("Link import busy for %s: %s", scrub_log(body.url), exc)
        raise_typed_error(exc, _ERROR_STATUS)
    return LinkUploadRead(**_upload_read(row).model_dump(), post_media=post_media)
