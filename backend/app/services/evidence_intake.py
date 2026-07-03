"""Shared evidence-intake orchestration for media-backed submissions.

The located view (``services/events``) and the requested view
(``services/bounties``) are both evidence-backed submissions over the one
``geolocations`` table: each validates an upload batch, streams every file to
S3 with key tracking, attaches one ``Media`` row per file, and must leave no
orphaned S3 object behind if the transaction rolls back. That tail — validate →
upload with key tracking → commit-or-sweep — lives here once; the two services
own only their type-specific rules (coordinates + the submit transition for the
located view, the open-request contract for the requested one) and call in for
the shared part.

Errors are typed :class:`EvidenceIntakeError` subclasses with stable
``.code`` strings. Each router maps the code to an HTTP status via the
same ``{code, message}`` envelope as ``RegistrationError`` / ``AdminError``
(seed map: :data:`EVIDENCE_INTAKE_ERROR_STATUS`). A service's own domain
errors subclass :class:`EvidenceIntakeError`, so a router catches one base
for both shared and type-specific failures.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.models.media import Media
from app.services.evidence_processing import EvidenceProcessingError
from app.services.storage import (
    UploadResult,
    get_storage,
    safe_original_filename,
    sweep_keys,
    validate_file,
)

# Per-submission file-count cap, shared by both submission types. Above a
# realistic OSINT batch (one source video + a handful of frames), tight
# enough to refuse a pathological multi-thousand-file payload that would pin
# the worker through the Pillow + derivative + S3 pipeline. Backed by the
# ``max_files_per_event`` setting, which `main`'s body-size middleware also
# reads at boot.
MAX_FILES_PER_SUBMISSION = settings.max_files_per_event


class EvidenceIntakeError(Exception):
    """Base for friendly errors raised during shared evidence intake.

    Carries a ``code`` so a router maps to an HTTP status without
    string-matching exception text. Mirrors
    :class:`app.services.admin.AdminError` /
    :class:`app.services.registration.RegistrationError`.
    """

    code: str = "evidence_intake_error"


class TooManyFilesError(EvidenceIntakeError):
    code = "too_many_files"


class MediaRequiredError(EvidenceIntakeError):
    code = "media_required"


class InvalidFileError(EvidenceIntakeError):
    code = "invalid_file"


class EvidenceProcessingFailedError(EvidenceIntakeError):
    code = "evidence_processing_failed"


# Status for the shared codes; each router spreads this then adds its own
# domain codes. Kept here so the shared mapping has one home.
EVIDENCE_INTAKE_ERROR_STATUS: dict[str, int] = {
    "too_many_files": 422,
    "media_required": 400,
    "invalid_file": 400,
    "evidence_processing_failed": 400,
}


def enforce_file_count(files: list[UploadFile]) -> None:
    """Reject an over-cap batch before any upload work. Cheap; call early."""
    if len(files) > MAX_FILES_PER_SUBMISSION:
        raise TooManyFilesError(f"At most {MAX_FILES_PER_SUBMISSION} files per submission")


async def attach_media_and_commit(
    db: Session,
    *,
    owner_id: uuid.UUID,
    files: list[UploadFile],
    upload: Callable[[UploadFile, uuid.UUID], Awaitable[UploadResult]],
    uploaded_ip: str | None,
    uploaded_user_agent: str | None,
    sweep_context: str,
    before_commit: Callable[[], None] | None = None,
) -> None:
    """Validate, upload, attach a ``Media`` row per file, then commit.

    Every ``Media`` row points at the owning ``events`` row via
    ``event_id = owner_id`` (media has a single owner since the merge);
    ``upload`` is the storage uploader the caller binds. The owning row must
    already be flushed so ``owner_id`` is populated.

    Every file is validated up front so a bad file #3 can't strand files
    #1-#2 in S3. The upload loop tracks each landed S3 key (original +
    derivatives). ``before_commit`` runs inside the try, before the commit
    (geolocations use it to adopt inline proof images), so its failure
    routes through the same cleanup. The commit is inside the try too, so a
    commit-time failure (FK violation, serialization conflict, PG blip)
    also sweeps the orphaned objects. Any exception rolls back and
    best-effort sweeps every key that landed (:func:`sweep_keys`), then
    re-raises.

    Raises :class:`InvalidFileError` (a file fails ``validate_file``) or
    :class:`EvidenceProcessingFailedError` (the uploader raises
    ``EvidenceProcessingError``).
    """
    # Validate every file before any upload — a 400 on file #3 shouldn't
    # strand files #1 and #2 in S3.
    media_types: list[str] = []
    for file in files:
        try:
            media_types.append(validate_file(file))
        except ValueError as exc:
            raise InvalidFileError(str(exc)) from exc

    # Track uploaded S3 keys so a mid-batch failure can sweep them on
    # rollback — otherwise file #1 lands, file #2 throws, the txn rolls
    # back, and file #1 is a chronic S3 orphan.
    uploaded_keys: list[str] = []
    try:
        for file, media_type in zip(files, media_types, strict=True):
            try:
                result = await upload(file, owner_id)
            except EvidenceProcessingError as exc:
                raise EvidenceProcessingFailedError(str(exc)) from exc
            media = Media(
                event_id=owner_id,
                storage_url=result.url,
                media_type=media_type,
                sha256=result.sha256,
                uploaded_ip=uploaded_ip,
                uploaded_user_agent=uploaded_user_agent,
                original_filename=safe_original_filename(file.filename),
            )
            db.add(media)
            key = get_storage().key_from_url(result.url)
            if key is not None:
                uploaded_keys.append(key)
                # Sweep the JPEG hero + thumbnail derivatives alongside the
                # original on row-side failure — an orphan derivative is the
                # same bucket leak at a smaller per-object cost.
                uploaded_keys.extend(result.derivative_keys)

        if before_commit is not None:
            before_commit()

        # Commit inside the try so a commit-time failure also routes through
        # the orphan cleanup; wrapping only the upload loop stranded S3
        # objects on commit failure.
        db.commit()
    except Exception:
        # Explicit rollback: don't rely on ``get_db``'s ``finally``, since
        # partially-added Media rows could be autoflushed by any query a
        # downstream error handler / metrics middleware runs.
        db.rollback()
        sweep_keys(uploaded_keys, context=sweep_context)
        raise
