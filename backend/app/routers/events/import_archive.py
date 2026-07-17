"""``import-archive``: backfill the caller's profile from their X data export."""

import logging
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.dependencies import get_current_user, get_db
from app.models.archive_import_job import ArchiveImportJob
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.event import ArchiveImportJobRead
from app.services import archive_jobs
from app.services.tweet_ingest import archive_zip

logger = logging.getLogger(__name__)
router = APIRouter()

# ArchiveIntakeError ``code`` → HTTP status. An over-cap upload or contents is a
# 413; a malformed zip or one with no ``tweets.js`` is a 400 client error.
_ARCHIVE_STATUS = {
    "archive_too_large": 413,
    "archive_no_tweets": 400,
    "archive_malformed": 400,
    "archive_invalid": 400,
}

_CHUNK = 1024 * 1024


@router.post(
    "/import-archive",
    response_model=ArchiveImportJobRead,
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit("10/hour")
async def import_archive(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enqueue the caller's X "Download your data" zip for the backfill worker.

    The upload is the consent: every row lands ``detected``, attributed to the
    caller (no handle-ownership check in this version, see ``planning``). Only the
    copy-allowlisted entries (``tweets.js`` + ``tweets_media/``) are ever read;
    the rest of the export is never extracted. The request validates the zip
    (shape + declared sizes, so a bad file 4xxs here, not in a failure email),
    stages it, and returns the ``queued`` job; the worker service runs the
    import and emails the outcome. Poll ``GET /events/import-archive/{job_id}``
    for the counts.
    """
    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / "upload.zip"

        # Stream to disk under the upload cap, so a huge (or hostile) upload is
        # never buffered in memory nor fully written before the cap trips.
        size = 0
        with open(zip_path, "wb") as out:
            while chunk := await file.read(_CHUNK):
                size += len(chunk)
                if size > archive_zip.MAX_UPLOAD_BYTES:
                    raise_typed_error(
                        archive_zip.ArchiveTooLargeError("Archive exceeds the upload size limit"),
                        _ARCHIVE_STATUS,
                    )
                out.write(chunk)

        try:
            inspection = archive_zip.inspect_archive(zip_path)
        except archive_zip.ArchiveIntakeError as exc:
            raise_typed_error(exc, _ARCHIVE_STATUS)

        # One bounded read (the staged object is capped by MAX_UPLOAD_BYTES),
        # in a worker thread: the read + the storage put are blocking I/O, and
        # a multi-second stall on the single-process event loop is the exact
        # failure mode this endpoint's async rework removed.
        job = await run_in_threadpool(
            lambda: archive_jobs.enqueue(
                db,
                owner=current_user,
                zip_bytes=zip_path.read_bytes(),
                post_estimate=inspection.post_estimate,
            )
        )

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
