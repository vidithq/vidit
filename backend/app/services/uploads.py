"""The first layer of the two-layer upload: stage a source file before the event write.

``POST /uploads`` stores one picked file and records an ``uploads`` row (:func:`stage_upload`), so
every request carries at most one file; a GIF stores, and records, one PNG per frame. An event write then names the row in a source's
``upload_id``; ``services/events/sources`` takes it (:func:`take_uploads`), turns it into the
source's ``media`` row and deletes it. A row nobody takes expires after ``UPLOAD_TTL`` and
:func:`reap_expired_uploads` deletes it with its object.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Iterable
from datetime import UTC, datetime

from fastapi import UploadFile
from sqlalchemy import delete, func
from sqlalchemy.orm import Session

from app.models.media import MediaKind
from app.models.upload import UPLOAD_TTL, Upload
from app.models.user import User
from app.services.evidence_intake import (
    EvidenceIntakeError,
    EvidenceProcessingFailedError,
    InvalidFileError,
    StoredObject,
    sweep_unreferenced,
)
from app.services.evidence_processing import EvidenceProcessingError
from app.services.storage import (
    StoredFile,
    UploadResult,
    get_storage,
    stored_file_count,
    sweep_keys,
    upload_source_bytes,
    upload_source_file,
    validate_bytes,
    validate_file,
)
from app.services.tweet_ingest import (
    MediaTooLarge,
    TweetFetchFailed,
    TweetImportError,
    chase_post,
    download_cdn_media,
    is_importable_link,
)

# Staged files one account may hold at once: two full event forms' worth. An abuse bound on
# storage held by files no event references.
MAX_PENDING_UPLOADS_PER_USER = 20


class UploadNotFoundError(EvidenceIntakeError):
    """A source names an upload that does not exist or belongs to someone else."""

    code = "upload_not_found"


class UploadExpiredError(EvidenceIntakeError):
    """A source names an upload past its ``expires_at``: upload the file again."""

    code = "upload_expired"


class TooManyUploadsError(EvidenceIntakeError):
    code = "too_many_uploads"


_LINK_REFUSALS = {
    "unsupported_link": "Import works with an X post, a public Telegram post or a TikTok post link.",
    "link_not_accessible": "The post or its file is gone, restricted or unreadable without a login.",
    "upstream_busy": "The post's host or its file host is not answering. Try again in a minute.",
}


class LinkImportError(EvidenceIntakeError):
    """A post link whose file cannot be staged; ``code`` names why."""

    def __init__(self, code: str, message: str | None = None) -> None:
        super().__init__(message or _LINK_REFUSALS[code])
        self.code = code


UPLOAD_ERROR_STATUS: dict[str, int] = {
    "upload_not_found": 400,
    "upload_expired": 400,
    "too_many_uploads": 429,
    "unsupported_link": 400,
    "link_not_accessible": 404,
    "link_has_no_file": 404,
    "upstream_busy": 503,
}


def _ensure_room(db: Session, uploader: User, now: datetime, needed: int = 1) -> None:
    pending = (
        db.query(func.count(Upload.id))
        .filter(Upload.uploader_id == uploader.id, Upload.expires_at > now)
        .scalar()
    )
    if pending + needed > MAX_PENDING_UPLOADS_PER_USER:
        raise TooManyUploadsError(
            f"You hold {pending} staged files no event uses yet; "
            f"submit or wait for them to expire before uploading more."
        )


async def _record(
    db: Session,
    *,
    uploader: User,
    kind: str,
    store: Awaitable[list[StoredFile]],
    now: datetime,
) -> list[Upload]:
    """Await ``store`` and record each file it stored as a staged row, in one commit."""
    try:
        stored = await store
    except EvidenceProcessingError as exc:
        raise EvidenceProcessingFailedError(str(exc)) from exc
    storage = get_storage()
    rows: list[Upload] = []
    keys: list[str] = []
    for result, original_filename in stored:
        key = storage.key_from_url(result.url)
        if key is None:  # pragma: no cover - both backends resolve their own URLs
            raise RuntimeError(f"Storage returned a URL it cannot resolve: {result.url}")
        keys += [key, *result.derivative_keys]
        rows.append(
            Upload(
                uploader_id=uploader.id,
                storage_key=key,
                kind=kind,
                sha256=result.sha256,
                original_filename=original_filename,
                expires_at=now + UPLOAD_TTL,
            )
        )
    db.add_all(rows)
    try:
        db.commit()
    except Exception:
        db.rollback()
        sweep_keys(keys, context="upload staging rollback")
        raise
    for row in rows:
        db.refresh(row)
    return rows


async def _unnamed(store: Awaitable[UploadResult]) -> list[StoredFile]:
    return [StoredFile(await store, None)]


async def stage_upload(db: Session, *, uploader: User, file: UploadFile) -> list[Upload]:
    """Store one picked file and record it for a later event write; commits.

    A GIF is stored and recorded as one PNG per frame, in frame order. Raises
    :class:`TooManyUploadsError` when the files would pass
    :data:`MAX_PENDING_UPLOADS_PER_USER` live rows, :class:`InvalidFileError` on a disallowed
    type or size, and :class:`EvidenceProcessingFailedError` when the image cannot be re-encoded
    or the GIF holds too many frames.
    """
    now = datetime.now(UTC)
    try:
        kind = validate_file(file)
    except ValueError as exc:
        raise InvalidFileError(str(exc)) from exc
    try:
        count = await asyncio.to_thread(stored_file_count, file)
    except EvidenceProcessingError as exc:
        raise EvidenceProcessingFailedError(str(exc)) from exc
    _ensure_room(db, uploader, now, count)
    return await _record(db, uploader=uploader, kind=kind, store=upload_source_file(file), now=now)


async def stage_from_link(
    db: Session, *, uploader: User, url: str, index: int = 0
) -> tuple[Upload, list[MediaKind]]:
    """Stage file ``index`` of the post ``url`` names, with the kind of every file it holds.

    Only a link a chaser reads is fetched (``tweet_ingest.chase_post``), and only a trusted CDN
    serves the file. Raises :func:`stage_upload`'s errors and :class:`LinkImportError`.
    """
    if not is_importable_link(url):
        raise LinkImportError("unsupported_link")
    now = datetime.now(UTC)
    _ensure_room(db, uploader, now)
    chased = await asyncio.to_thread(chase_post, url)
    if chased.outcome == "transient_failure":
        raise LinkImportError("upstream_busy")
    if chased.post is None:
        raise LinkImportError("link_not_accessible")
    media = chased.post.media
    if index >= len(media):
        raise LinkImportError(
            "link_has_no_file",
            "The post serves no file." if not media else f"The post holds {len(media)} files.",
        )
    parsed = media[index]
    try:
        data = await download_cdn_media(parsed)
    except MediaTooLarge as exc:
        raise InvalidFileError("File too large") from exc
    except TweetFetchFailed as exc:
        raise LinkImportError("upstream_busy") from exc
    except TweetImportError as exc:
        raise LinkImportError("link_not_accessible") from exc
    try:
        kind = validate_bytes(data, parsed.content_type)
    except ValueError as exc:
        raise InvalidFileError(str(exc)) from exc
    [upload] = await _record(
        db,
        uploader=uploader,
        kind=kind,
        store=_unnamed(upload_source_bytes(data, parsed.content_type)),
        now=now,
    )
    return upload, [item.kind for item in media]


def storage_url_of(upload: Upload) -> str:
    return get_storage().public_url(upload.storage_key)


def take_uploads(
    db: Session, *, uploader: User, upload_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, Upload]:
    """Lock the staged rows a write references, by id.

    The row lock makes a second write naming the same upload wait, then find it gone.
    Raises :class:`UploadNotFoundError` for an id that is unknown or another account's, and
    :class:`UploadExpiredError` for one past ``expires_at``.
    """
    ids = set(upload_ids)
    if not ids:
        return {}
    rows = {
        row.id: row
        for row in db.query(Upload)
        .filter(Upload.id.in_(ids), Upload.uploader_id == uploader.id)
        .with_for_update()
        .all()
    }
    missing = ids - set(rows)
    if missing:
        raise UploadNotFoundError(
            "A source names an upload that does not exist: " + ", ".join(sorted(map(str, missing)))
        )
    now = datetime.now(UTC)
    expired = sorted(str(row.id) for row in rows.values() if row.expires_at <= now)
    if expired:
        raise UploadExpiredError(
            "A source names an upload that has expired; upload the file again: "
            + ", ".join(expired)
        )
    return rows


def upload_object(upload: Upload) -> StoredObject:
    return StoredObject(storage_url_of(upload), upload.kind)


def reap_expired_uploads(db: Session) -> int:
    """Delete the staged rows past ``expires_at`` and their objects; returns the row count.

    Run by the import worker every pass. Commit-then-sweep, and only objects no ``media``
    row names (an upload taken by a write has no row left, so this is a guard).
    """
    reaped = db.execute(
        delete(Upload)
        .where(Upload.expires_at <= datetime.now(UTC))
        .returning(Upload.storage_key, Upload.kind)
    ).all()
    db.commit()
    storage = get_storage()
    sweep_unreferenced(
        db,
        [StoredObject(storage.public_url(key), kind) for key, kind in reaped],
        context="expired uploads",
    )
    return len(reaped)
