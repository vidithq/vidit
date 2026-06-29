"""``import-archive``: backfill the caller's profile from their X data export."""

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.ratelimit import limiter
from app.routers._errors import raise_typed_error
from app.schemas.geolocation import ArchiveImportResult
from app.services.detection import backfill_from_archive
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


@router.post("/import-archive", response_model=ArchiveImportResult)
@limiter.limit("10/hour")
async def import_archive(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Backfill the caller's profile from their X "Download your data" zip.

    The upload is the consent: every row lands ``detected``, attributed to the
    caller (no handle-ownership check in this version, see ``planning``). Only the
    copy-allowlisted entries (``tweets.js`` + ``tweets_media/``) are read; the
    rest of the export is never extracted. The import runs synchronously behind a
    size cap (``archive_zip.MAX_UPLOAD_BYTES``); a larger archive waits for the
    durable-worker upgrade. Returns the assemble counts.
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / "upload.zip"
        archive_dir = tmp_path / "archive"
        archive_dir.mkdir()

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
            archive_zip.extract_allowlisted(zip_path, archive_dir)
        except archive_zip.ArchiveIntakeError as exc:
            raise_typed_error(exc, _ARCHIVE_STATUS)

        outcome = await backfill_from_archive(db, owner=current_user, archive_dir=archive_dir)

    logger.info(
        "Archive backfill for user %s: created=%d skipped=%d recreated=%d failed=%d",
        current_user.id,
        len(outcome.created),
        outcome.skipped,
        outcome.recreated,
        outcome.failed,
    )
    return ArchiveImportResult(
        created=len(outcome.created),
        skipped=outcome.skipped,
        recreated=outcome.recreated,
        failed=outcome.failed,
    )
