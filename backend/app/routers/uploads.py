"""``POST /uploads``: stage one picked source file before the event write that names it."""

import asyncio
import logging

from fastapi import APIRouter, File, Request, UploadFile, status

from app.dependencies import DB, CurrentUser
from app.models.upload import Upload
from app.ratelimit import limiter
from app.schemas.source import (
    LinkUploadRead,
    UploadFromLink,
    UploadFromProof,
    UploadList,
    UploadRead,
)
from app.services import uploads as uploads_service
from app.services.storage import scrub_log

logger = logging.getLogger(__name__)
router = APIRouter()


def _upload_read(row: Upload) -> UploadRead:
    return UploadRead(
        id=row.id,
        kind=row.kind,
        sha256=row.sha256,
        original_filename=row.original_filename,
        storage_url=uploads_service.storage_url_of(row),
        expires_at=row.expires_at,
    )


@router.post("", response_model=UploadList, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_upload(
    request: Request,
    current_user: CurrentUser,
    db: DB,
    # One file per request: the request size limit admits one video.
    file: UploadFile = File(...),
) -> UploadList:
    """Stage one source file, or each frame of a GIF; a source of a later event write names one by ``id``.

    The file is validated (type, size) and stored now, and each row expires
    after 24 hours unless a write takes it. 400 on an invalid file, 429 past
    the per-account ceiling of staged files.
    """
    rows = asyncio.run(uploads_service.stage_upload(db, uploader=current_user, file=file))
    return UploadList(items=[_upload_read(row) for row in rows])


# ``def`` plus ``asyncio.run``, as ``import-from-tweet``: the chase and the download block.
@router.post("/from-link", response_model=LinkUploadRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_upload_from_link(
    request: Request, body: UploadFromLink, current_user: CurrentUser, db: DB
) -> LinkUploadRead:
    """Stage the file of a post link, as ``POST /uploads`` stages a picked one."""
    try:
        row, post_media = asyncio.run(
            uploads_service.stage_from_link(
                db, uploader=current_user, url=body.url, index=body.index
            )
        )
    except uploads_service.LinkImportError as exc:
        if exc.code == "upstream_busy":
            logger.warning("Link import busy for %s: %s", scrub_log(body.url), exc)
        raise
    return LinkUploadRead(**_upload_read(row).model_dump(), post_media=post_media)


@router.post("/from-proof", response_model=UploadRead, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_upload_from_proof(
    request: Request, body: UploadFromProof, current_user: CurrentUser, db: DB
) -> UploadRead:
    """Stage a copy of a proof image of an event you edit, as ``POST /uploads`` stages a file."""
    row = asyncio.run(
        uploads_service.stage_from_proof(
            db, uploader=current_user, event_id=body.event_id, url=body.url
        )
    )
    return _upload_read(row)
