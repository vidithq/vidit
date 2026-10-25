"""``POST /uploads``: stage one source file before the event write that names it."""

import asyncio

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.source import UploadRead
from app.services import uploads as uploads_service
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError

router = APIRouter()


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
        raise_typed_error(
            exc, {**EVIDENCE_INTAKE_ERROR_STATUS, **uploads_service.UPLOAD_ERROR_STATUS}
        )
    return UploadRead(
        id=row.id,
        kind=row.kind,
        sha256=row.sha256,
        original_filename=row.original_filename,
        storage_url=uploads_service.storage_url_of(row),
        expires_at=row.expires_at,
    )
