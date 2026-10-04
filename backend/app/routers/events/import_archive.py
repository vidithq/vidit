"""``import-archive``: backfill the caller's profile from their X data export.

Two steps: ``POST /import-archive/presign`` mints a staging key and a presigned
direct-to-storage upload, the browser POSTs the stripped zip there, then
``POST /import-archive`` verifies the staged object and enqueues the job. The
zip never transits the API, so the size limit is a storage-side guard
(``archive_zip.MAX_UPLOAD_BYTES``), not an HTTP body cap.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.archive_import_job import ArchiveImportJob
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.event import (
    ArchiveImportEnqueue,
    ArchiveImportJobRead,
    ArchiveImportPresignRead,
    PresignedUploadRead,
)
from app.services import archive_jobs
from app.services.storage import get_storage
from app.services.tweet_ingest import archive_zip

logger = logging.getLogger(__name__)
router = APIRouter()

# StagedUploadError ``code`` to status: foreign or malformed key 400, nothing
# uploaded 404, over the guard 413.
_ARCHIVE_STATUS = {
    "archive_upload_invalid": 400,
    "archive_upload_missing": 404,
    "archive_too_large": 413,
}


@router.post("/import-archive/presign", response_model=ArchiveImportPresignRead)
@limiter.limit("10/hour")
def presign_import_archive(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Mint a staging key + presigned upload for the caller's stripped zip.

    No content validation: the worker re-runs the hardened allowlist. The key
    embeds the caller's id, so only their own enqueue can consume it.
    """
    key = archive_jobs.mint_staging_key(current_user.id)
    upload = get_storage().presign_staging_upload(
        key, max_bytes=archive_zip.MAX_UPLOAD_BYTES, content_type="application/zip"
    )
    return ArchiveImportPresignRead(
        upload_key=key, upload=PresignedUploadRead(url=upload.url, fields=upload.fields)
    )


@router.post(
    "/import-archive",
    response_model=ArchiveImportJobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit("10/hour")
def import_archive(
    request: Request,
    body: ArchiveImportEnqueue,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enqueue the caller's staged X "Download your data" zip for the worker.

    The upload is the consent: every row lands ``detected``, attributed to the
    caller, and the export is not checked against the linked handle. The
    request verifies the staged object (own key, present, under the size
    guard) and returns the ``queued`` job; the worker extracts only allowlisted
    entries and emails the outcome. Poll
    ``GET /events/import-archive/{job_id}`` for counts.
    """
    try:
        archive_jobs.verify_staged_upload(body.upload_key, owner_id=current_user.id)
        job = archive_jobs.enqueue(
            db,
            owner=current_user,
            upload_key=body.upload_key,
            post_estimate=body.post_estimate,
        )
    except archive_jobs.StagedUploadError as exc:
        raise_typed_error(exc, _ARCHIVE_STATUS)
    logger.info("Archive import staged for user %s: job %s", current_user.id, job.id)
    return job


@router.get("/import-archive/{job_id}", response_model=ArchiveImportJobRead)
@limiter.limit("60/minute")
def get_import_job(
    request: Request,
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's import job, polled until terminal. Someone else's job id
    reads as 404, same as unknown."""
    job = db.get(ArchiveImportJob, job_id)
    if job is None or job.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Import job not found")
    return job
