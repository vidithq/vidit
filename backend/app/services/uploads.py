"""The first layer of the two-layer upload: stage a source file before the event write.

``POST /uploads`` stores one file and records an ``uploads`` row (:func:`stage_upload`), so
every request carries at most one file. An event write then names the row in a source's
``upload_id``; ``services/events/sources`` takes it (:func:`take_uploads`), turns it into the
source's ``media`` row and deletes it. A row nobody takes expires after ``UPLOAD_TTL`` and
:func:`reap_expired_uploads` deletes it with its object.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Iterable
from dataclasses import dataclass
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
    UploadResult,
    get_storage,
    safe_original_filename,
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


class UnsupportedLinkError(EvidenceIntakeError):
    """No chaser reads the link (``tweet_ingest.is_importable_link``), so nothing is fetched."""

    code = "unsupported_link"


class LinkNotAccessibleError(EvidenceIntakeError):
    """The post, or its file, is gone, restricted or unreadable."""

    code = "link_not_accessible"


class LinkHasNoFileError(EvidenceIntakeError):
    """The post answered with no file to take, or none at the asked index."""

    code = "link_has_no_file"


class LinkUpstreamBusyError(EvidenceIntakeError):
    """The post's host throttled or did not answer once the retries were spent."""

    code = "upstream_busy"


UPLOAD_ERROR_STATUS: dict[str, int] = {
    "upload_not_found": 400,
    "upload_expired": 400,
    "too_many_uploads": 429,
    "unsupported_link": 400,
    "link_not_accessible": 404,
    "link_has_no_file": 404,
    "upstream_busy": 503,
}


@dataclass(frozen=True)
class LinkUpload:
    """A file staged from a post link, and the kind of every file the post holds."""

    upload: Upload
    post_media: list[MediaKind]


def _ensure_room(db: Session, uploader: User, now: datetime) -> None:
    pending = (
        db.query(func.count(Upload.id))
        .filter(Upload.uploader_id == uploader.id, Upload.expires_at > now)
        .scalar()
    )
    if pending >= MAX_PENDING_UPLOADS_PER_USER:
        raise TooManyUploadsError(
            f"You hold {pending} staged files no event uses yet; "
            f"submit or wait for them to expire before uploading more."
        )


async def _record(
    db: Session,
    *,
    uploader: User,
    kind: str,
    store: Awaitable[UploadResult],
    original_filename: str | None,
    now: datetime,
) -> Upload:
    """Await ``store`` and record what it stored as a staged row; commits."""
    try:
        result = await store
    except EvidenceProcessingError as exc:
        raise EvidenceProcessingFailedError(str(exc)) from exc
    storage = get_storage()
    key = storage.key_from_url(result.url)
    if key is None:  # pragma: no cover - both backends resolve their own URLs
        raise RuntimeError(f"Storage returned a URL it cannot resolve: {result.url}")
    row = Upload(
        uploader_id=uploader.id,
        storage_key=key,
        kind=kind,
        sha256=result.sha256,
        original_filename=original_filename,
        expires_at=now + UPLOAD_TTL,
    )
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        sweep_keys([key, *result.derivative_keys], context="upload staging rollback")
        raise
    db.refresh(row)
    return row


async def stage_upload(db: Session, *, uploader: User, file: UploadFile) -> Upload:
    """Store one source file and record it for a later event write; commits.

    Raises :class:`TooManyUploadsError` past :data:`MAX_PENDING_UPLOADS_PER_USER` live rows,
    :class:`InvalidFileError` on a disallowed type or size, and
    :class:`EvidenceProcessingFailedError` when the image cannot be re-encoded.
    """
    now = datetime.now(UTC)
    _ensure_room(db, uploader, now)
    try:
        kind = validate_file(file)
    except ValueError as exc:
        raise InvalidFileError(str(exc)) from exc
    return await _record(
        db,
        uploader=uploader,
        kind=kind,
        store=upload_source_file(file),
        original_filename=safe_original_filename(file.filename),
        now=now,
    )


async def stage_from_link(db: Session, *, uploader: User, url: str, index: int = 0) -> LinkUpload:
    """Fetch file ``index`` of the post ``url`` names and stage it as :func:`stage_upload` does.

    The chase picks the fetch (``tweet_ingest.chase_post``): only an X status or a public
    Telegram post is read, through its fixed upstream, and only a trusted CDN serves the file.
    Raises :func:`stage_upload`'s errors, plus :class:`UnsupportedLinkError`,
    :class:`LinkNotAccessibleError`, :class:`LinkHasNoFileError` and
    :class:`LinkUpstreamBusyError`.
    """
    if not is_importable_link(url):
        raise UnsupportedLinkError("Import works with an X post or a public Telegram post link.")
    now = datetime.now(UTC)
    _ensure_room(db, uploader, now)
    chased = await asyncio.to_thread(chase_post, url)
    if chased.outcome == "transient_failure":
        raise LinkUpstreamBusyError("The post's host is not answering. Try again in a minute.")
    if chased.post is None:
        raise LinkNotAccessibleError("The post is gone, restricted or unreadable without a login.")
    media = chased.post.media
    if index >= len(media):
        raise LinkHasNoFileError(
            "The post serves no file." if not media else f"The post holds {len(media)} files."
        )
    parsed = media[index]
    try:
        data = await download_cdn_media(parsed)
    except MediaTooLarge as exc:
        raise InvalidFileError("File too large") from exc
    except TweetFetchFailed as exc:
        raise LinkUpstreamBusyError(
            "The post's file host is not answering. Try again in a minute."
        ) from exc
    except TweetImportError as exc:
        raise LinkNotAccessibleError("The post's file could not be read.") from exc
    try:
        kind = validate_bytes(data, parsed.content_type)
    except ValueError as exc:
        raise InvalidFileError(str(exc)) from exc
    upload = await _record(
        db,
        uploader=uploader,
        kind=kind,
        store=upload_source_bytes(data, parsed.content_type),
        original_filename=None,
        now=now,
    )
    return LinkUpload(upload=upload, post_media=[item.kind for item in media])


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
