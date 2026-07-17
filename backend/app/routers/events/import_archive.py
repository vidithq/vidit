"""``import-archive``: backfill the caller's profile from their X data export.

Two steps: ``POST /import-archive/presign`` mints a staging key and a
presigned direct-to-storage upload, the browser POSTs the stripped zip there
itself, then the JSON ``POST /import-archive`` verifies the staged object and
enqueues the job. The zip never transits the API, so the archive size limit is
the storage-side sanity guard (``archive_zip.MAX_UPLOAD_BYTES``), not an HTTP
body cap, and the API stays proxyable behind Cloudflare's request-size cap.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

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

# StagedUploadError ``code`` → HTTP status: a foreign or malformed key is a
# 400, a key with nothing uploaded behind it a 404, an over-guard object a 413.
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

    No content validation here: the browser strip already shaped the zip, and
    the worker re-runs the hardened allowlist regardless. The key embeds the
    caller's id, so only the caller's own enqueue can consume it.
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
async def import_archive(
    request: Request,
    body: ArchiveImportEnqueue,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enqueue the caller's staged X "Download your data" zip for the worker.

    The upload is the consent: every row lands ``detected``, attributed to the
    caller (no handle-ownership check in this version, see ``planning``). The
    request verifies the staged object (the caller's own key, present, under
    the size guard) and returns the ``queued`` job; the worker service runs
    the import (extracting only the allowlisted entries) and emails the
    outcome. Poll ``GET /events/import-archive/{job_id}`` for the counts.
    """
    try:
        # Both steps block (a storage HEAD, then a DB commit): a thread keeps
        # the single-process event loop serving siblings meanwhile.
        await run_in_threadpool(
            archive_jobs.verify_staged_upload, body.upload_key, owner_id=current_user.id
        )
        job = await run_in_threadpool(
            archive_jobs.enqueue,
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
    """The caller's import job, for the upload page to poll until terminal.

    Owner-only: someone else's job id reads as 404 (indistinguishable from
    unknown, so ids don't leak whether an import exists).
    """
    job = db.get(ArchiveImportJob, job_id)
    if job is None or job.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Import job not found")
    return job
