"""Shared evidence-intake orchestration for media-backed submissions.

Every write that attaches files to an event (direct geolocate, request
create, the geolocate transition) funnels through
:func:`attach_evidence_and_commit`: validate the batch up front, stream the
source file and the proof images to S3 with key tracking, attach one ``Media``
row per file (``role='source'`` / ``role='proof'``), rewrite the proof doc's
``placeholder://`` srcs to the landed URLs, drop proof rows the incoming doc
no longer references, then commit-or-sweep. The event services own only their
type-specific rules (coordinates, lifecycle transitions, the evidence floor)
and call in for the shared tail.

Proof images travel INSIDE the multipart submit (upload at publish): the
Tiptap doc references a not-yet-uploaded file as ``placeholder://<filename>``
and the request carries the file in ``proof_files``. Matching is by sanitised
original filename; a placeholder with no file, or a file no placeholder
references, is a 400: nothing uploads on a mismatched batch. The rollback
path keeps the best-effort ``sweep_keys`` on commit failure (the accepted
residual risk, same as source media).

Errors are typed :class:`EvidenceIntakeError` subclasses with stable
``.code`` strings. Each router maps the code to an HTTP status via the
same ``{code, message}`` envelope as ``RegistrationError`` / ``AdminError``
(seed map: :data:`EVIDENCE_INTAKE_ERROR_STATUS`). A service's own domain
errors subclass :class:`EvidenceIntakeError`, so a router catches one base
for both shared and type-specific failures.
"""

from __future__ import annotations

from typing import Any

from fastapi import UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.models.event import Event
from app.models.media import Media
from app.services.evidence_processing import EvidenceProcessingError
from app.services.sanitize import PROOF_PLACEHOLDER_PREFIX, extract_image_srcs
from app.services.storage import (
    derivative_key,
    get_storage,
    safe_original_filename,
    sweep_keys,
    upload_file,
    upload_proof_image,
    validate_file,
)


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


class ProofFilesMismatchError(EvidenceIntakeError):
    """A ``placeholder://`` src with no matching upload, or vice versa."""

    code = "proof_files_mismatch"


class SourceMediaConflictError(EvidenceIntakeError):
    """A second ``source`` row raced past the app-level cap.

    The ``uq_media_source_per_event`` partial unique index is the backstop;
    this maps its ``IntegrityError`` to a 409 instead of a 500.
    """

    code = "source_media_conflict"


# Status for the shared codes; each router spreads this then adds its own
# domain codes. Kept here so the shared mapping has one home.
EVIDENCE_INTAKE_ERROR_STATUS: dict[str, int] = {
    "too_many_files": 422,
    "media_required": 400,
    "invalid_file": 400,
    "evidence_processing_failed": 400,
    "proof_files_mismatch": 400,
    "source_media_conflict": 409,
}


def _match_proof_files(
    proof_doc: dict[str, Any] | None, proof_files: list[UploadFile]
) -> list[tuple[str, UploadFile]]:
    """Pair each ``placeholder://<filename>`` src with its uploaded file.

    Strict both ways (an unmatched placeholder would persist as a broken
    image, an unreferenced file as an untracked S3 object) and cheap, so it
    runs before any upload. Returns ``(placeholder_src, file)`` pairs in doc
    order.
    """
    placeholders = (
        [s for s in extract_image_srcs(proof_doc) if s.startswith(PROOF_PLACEHOLDER_PREFIX)]
        if proof_doc is not None
        else []
    )
    files_by_name: dict[str, UploadFile] = {}
    for file in proof_files:
        name = safe_original_filename(file.filename)
        if name is None:
            raise ProofFilesMismatchError("A proof file carries no usable filename")
        if name in files_by_name:
            # Ambiguous match: two files claim the same placeholder name.
            raise ProofFilesMismatchError(f"Duplicate proof file name: {name}")
        files_by_name[name] = file

    pairs: list[tuple[str, UploadFile]] = []
    referenced: set[str] = set()
    for src in placeholders:
        name = src[len(PROOF_PLACEHOLDER_PREFIX) :]
        matched = files_by_name.get(name)
        if matched is None:
            raise ProofFilesMismatchError(f"No uploaded proof file matches placeholder: {name}")
        referenced.add(name)
        pairs.append((src, matched))
    unreferenced = set(files_by_name) - referenced
    if unreferenced:
        raise ProofFilesMismatchError(
            "Proof files not referenced by the proof body: " + ", ".join(sorted(unreferenced))
        )
    return pairs


def _rewrite_image_srcs(doc: dict[str, Any], mapping: dict[str, str]) -> None:
    """Swap image srcs per ``mapping``, in place, across the whole tree."""

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "image":
            attrs = node.get("attrs")
            if isinstance(attrs, dict) and attrs.get("src") in mapping:
                attrs["src"] = mapping[attrs["src"]]
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                walk(child)

    walk(doc)


async def attach_evidence_and_commit(
    db: Session,
    *,
    event: Event,
    source_files: list[UploadFile],
    proof_doc: dict[str, Any] | None,
    proof_files: list[UploadFile],
    sweep_context: str,
) -> None:
    """Upload + attach an event's evidence, rewrite its proof doc, commit.

    The one shared write tail. ``event`` must already be flushed (its id feeds
    the S3 keys and the ``Media`` FK) and any replaced ``source`` rows must be
    deleted AND flushed by the caller first, so the partial unique index isn't
    tripped mid-flush by a delete ordered after the insert.

    * ``source_files`` (0 or 1, the caller enforces the count) land as
      ``Media(role='source')`` under ``uploads/<event>/``.
    * ``proof_doc`` is the sanitised incoming Tiptap document, or ``None`` to
      keep ``event.proof`` as already set on the row. Its ``placeholder://``
      srcs are matched to ``proof_files`` (see :func:`_match_proof_files`),
      each file uploads through the proof-image pipeline (no derivatives), the
      src is rewritten to the public URL, and a ``Media(role='proof')`` row
      lands. Already-uploaded S3 URLs in the doc pass through untouched (the
      edit flow), and existing ``role='proof'`` rows whose URL no longer
      appears in the final doc are deleted, their objects swept post-commit.

    Every file is validated up front so a bad file can't strand its siblings
    in S3. The commit is inside the try, so a commit-time failure (FK
    violation, serialization conflict, PG blip) also sweeps the orphaned
    objects; an ``IntegrityError`` on ``uq_media_source_per_event`` surfaces
    as the 409-shaped :class:`SourceMediaConflictError`, not a 500.

    Raises :class:`TooManyFilesError` (proof batch over
    ``max_proof_images_per_event``), :class:`InvalidFileError` (a file fails
    ``validate_file``, or a non-image in ``proof_files``),
    :class:`ProofFilesMismatchError`, or
    :class:`EvidenceProcessingFailedError` (the uploader raises
    ``EvidenceProcessingError``).
    """
    if len(proof_files) > settings.max_proof_images_per_event:
        raise TooManyFilesError(
            f"At most {settings.max_proof_images_per_event} proof images per event"
        )

    # Validate every file before any upload — a 400 on file #3 shouldn't
    # strand files #1 and #2 in S3.
    source_types: list[str] = []
    for file in source_files:
        try:
            source_types.append(validate_file(file))
        except ValueError as exc:
            raise InvalidFileError(str(exc)) from exc
    for file in proof_files:
        try:
            kind = validate_file(file)
        except ValueError as exc:
            raise InvalidFileError(str(exc)) from exc
        if kind != "image":
            raise InvalidFileError(
                f"File type {file.content_type} not allowed for a proof image (image required)"
            )

    # Match placeholders to files before any S3 work; a mismatched batch is a
    # clean 400 with nothing to sweep.
    proof_pairs = _match_proof_files(proof_doc, proof_files)

    # Diff the kept proof rows against the FINAL doc (incoming when provided,
    # else what the row already holds). Placeholder srcs resolve to new
    # uploads, so only real URLs participate.
    final_doc = proof_doc if proof_doc is not None else event.proof
    kept_srcs = {
        s for s in extract_image_srcs(final_doc) if not s.startswith(PROOF_PLACEHOLDER_PREFIX)
    }
    storage = get_storage()
    removed_proof_keys: list[str] = []
    for m in list(event.media):
        if m.role != "proof" or m.storage_url in kept_srcs:
            continue
        key = storage.key_from_url(m.storage_url)
        if key is not None:
            removed_proof_keys.append(key)
        db.delete(m)
    # Flush deletes before the inserts below (same discipline as the caller's
    # source swap) so a same-URL re-add can't collide mid-flush.
    db.flush()

    # Track uploaded S3 keys so a mid-batch failure can sweep them on
    # rollback — otherwise file #1 lands, file #2 throws, the txn rolls
    # back, and file #1 is a chronic S3 orphan.
    uploaded_keys: list[str] = []
    try:
        for file, media_type in zip(source_files, source_types, strict=True):
            try:
                result = await upload_file(file, event.id)
            except EvidenceProcessingError as exc:
                raise EvidenceProcessingFailedError(str(exc)) from exc
            db.add(
                Media(
                    event_id=event.id,
                    role="source",
                    storage_url=result.url,
                    media_type=media_type,
                    sha256=result.sha256,
                    original_filename=safe_original_filename(file.filename),
                )
            )
            key = storage.key_from_url(result.url)
            if key is not None:
                uploaded_keys.append(key)
                # Sweep the JPEG hero + thumbnail derivatives alongside the
                # original on row-side failure — an orphan derivative is the
                # same bucket leak at a smaller per-object cost.
                uploaded_keys.extend(result.derivative_keys)

        src_by_placeholder: dict[str, str] = {}
        for placeholder_src, file in proof_pairs:
            try:
                result = await upload_proof_image(file, event.owner_id)
            except EvidenceProcessingError as exc:
                raise EvidenceProcessingFailedError(str(exc)) from exc
            src_by_placeholder[placeholder_src] = result.url
            db.add(
                Media(
                    event_id=event.id,
                    role="proof",
                    storage_url=result.url,
                    media_type="image",
                    sha256=result.sha256,
                    original_filename=safe_original_filename(file.filename),
                )
            )
            key = storage.key_from_url(result.url)
            if key is not None:
                uploaded_keys.append(key)
                uploaded_keys.extend(result.derivative_keys)

        if proof_doc is not None:
            _rewrite_image_srcs(proof_doc, src_by_placeholder)
            event.proof = proof_doc

        # Commit inside the try so a commit-time failure also routes through
        # the orphan cleanup; wrapping only the upload loop stranded S3
        # objects on commit failure.
        db.commit()
    except IntegrityError as exc:
        # Explicit rollback: don't rely on ``get_db``'s ``finally``, since
        # partially-added Media rows could be autoflushed by any query a
        # downstream error handler / metrics middleware runs.
        db.rollback()
        sweep_keys(uploaded_keys, context=sweep_context)
        if "uq_media_source_per_event" in str(exc.orig):
            raise SourceMediaConflictError(
                "The event already carries a source media (concurrent edit)"
            ) from exc
        raise
    except Exception:
        db.rollback()
        sweep_keys(uploaded_keys, context=sweep_context)
        raise

    # Committed; sweep the dropped proof images' objects (best-effort). Proof
    # uploads skip derivatives, so the original key is the whole footprint.
    sweep_keys(removed_proof_keys, context=f"{sweep_context} (removed proof images)")


def collect_media_keys(media_rows: list[Media]) -> list[str]:
    """S3 keys for a set of ``Media`` rows, derivatives included.

    The shared "what does deleting these rows orphan on S3" resolver used by
    the owner DELETE. Hero / thumb JPEG derivatives exist only for ``source``
    images (proof uploads and videos skip them). Foreign URLs (nothing this
    storage layer wrote) resolve to no key and are skipped.
    """
    storage = get_storage()
    keys: list[str] = []
    for m in media_rows:
        key = storage.key_from_url(m.storage_url)
        if key is None:
            continue
        keys.append(key)
        if m.role == "source" and m.media_type == "image":
            keys.append(derivative_key(key, "hero"))
            keys.append(derivative_key(key, "thumb"))
    return keys
