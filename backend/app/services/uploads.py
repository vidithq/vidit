"""The first layer of the two-layer upload: stage a source file before the event write.

``POST /uploads`` stores one file and records an ``uploads`` row (:func:`stage_upload`), so
every request carries at most one file. An event write then names the row in a source's
``upload_id``; ``services/events/sources`` takes it (:func:`take_uploads`), turns it into the
source's ``media`` row and deletes it. A row nobody takes expires after ``UPLOAD_TTL`` and
:func:`reap_expired_uploads` deletes it with its object.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from fastapi import UploadFile
from sqlalchemy import delete, func
from sqlalchemy.orm import Session

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
    get_storage,
    safe_original_filename,
    sweep_keys,
    upload_source_file,
    validate_file,
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


UPLOAD_ERROR_STATUS: dict[str, int] = {
    "upload_not_found": 400,
    "upload_expired": 400,
    "too_many_uploads": 429,
}


async def stage_upload(db: Session, *, uploader: User, file: UploadFile) -> Upload:
    """Store one source file and record it for a later event write; commits.

    Raises :class:`TooManyUploadsError` past :data:`MAX_PENDING_UPLOADS_PER_USER` live rows,
    :class:`InvalidFileError` on a disallowed type or size, and
    :class:`EvidenceProcessingFailedError` when the image cannot be re-encoded.
    """
    now = datetime.now(UTC)
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
    try:
        kind = validate_file(file)
    except ValueError as exc:
        raise InvalidFileError(str(exc)) from exc
    try:
        result = await upload_source_file(file)
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
        original_filename=safe_original_filename(file.filename),
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
