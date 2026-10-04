"""Shared evidence-intake orchestration for media-backed submissions.

Every write that attaches files to an event funnels through
:func:`attach_evidence_and_commit`: validate the batch, upload the source file
and proof images to S3 with key tracking, attach one ``Media`` row per file,
rewrite the proof doc's ``placeholder://`` srcs, drop proof rows the doc no
longer references, then commit-or-sweep. Event services own only their
type-specific rules.

Proof images travel inside the multipart submit: the Tiptap doc references a
not-yet-uploaded file as ``placeholder://<filename>`` and the file arrives in
``proof_files``. Matching is by sanitised original filename; a placeholder
with no file, or a file no placeholder references, is a 400 and nothing
uploads. ``sweep_keys`` on commit failure is best-effort.

Errors are :class:`EvidenceIntakeError` subclasses with stable ``.code``
strings, mapped to HTTP status by each router (seed map:
:data:`EVIDENCE_INTAKE_ERROR_STATUS`). A service's own domain errors subclass
it, so a router catches one base.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from typing import Any, cast

from fastapi import UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.models.event import Event
from app.models.media import Media
from app.services import versions
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

logger = logging.getLogger(__name__)


class EvidenceIntakeError(Exception):
    """Base for evidence-intake errors; ``code`` maps to an HTTP status.

    Mirrors :class:`app.services.admin.AdminError` and
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
    """A second ``source`` row raced past the cap (``uq_media_source_per_event`` backstop)."""

    code = "source_media_conflict"


# Each router spreads this, then adds its own domain codes.
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

    Strict both ways (an unmatched placeholder persists as a broken image, an
    unreferenced file as an untracked S3 object); runs before any upload.
    Returns ``(placeholder_src, file)`` pairs in doc order.
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


def _displayed_proof_srcs(doc: dict[str, Any] | None) -> set[str]:
    """The already-uploaded proof-image URLs a proof body displays (placeholders excluded)."""
    return {s for s in extract_image_srcs(doc) if not s.startswith(PROOF_PLACEHOLDER_PREFIX)}


def _history_pinned_srcs(db: Session, event: Event) -> set[str]:
    """The proof-image URLs this event's readable snapshots display.

    A proof image a past version still shows survives, row and object, after
    the current body drops it, so history stays renderable.

    Version 1 has no snapshot, so it pays no query. Precondition:
    ``services/versions.file_version`` has already bumped ``version_no`` and
    staged this write's snapshot, so the superseded version's images aren't
    swept by the same write.
    """
    if event.version_no <= 1:
        return set()
    return versions.referenced_media_urls(db, event.id)


def _history_pinned_source_srcs(db: Session, event: Event) -> set[str]:
    """The source-media URLs this event's readable snapshots render.

    The source twin of :func:`_history_pinned_srcs`: an anchor swap deletes the
    replaced row, so only the snapshots name that object (see
    ``services/versions.referenced_source_media``).
    """
    if event.version_no <= 1:
        return set()
    return {
        url
        for entry in versions.referenced_source_media(db, event.id)
        if isinstance(url := entry.get("storage_url"), str)
    }


def _reject_foreign_proof_srcs(db: Session, event: Event, displayed_srcs: set[str]) -> None:
    """Refuse a proof body that displays another event's stored image.

    The sanitiser (``services/sanitize._safe_image_src``) checks where a URL
    lives, not whose it is. A src this storage layer wrote (``key_from_url``
    resolves it) must be one of THIS event's media rows; otherwise event B could
    embed A's image and A's next edit would sweep it from under B.

    Both roles count as own: a proof body may cite the event's source frame, and
    only ``proof`` rows are diffed, so a cited source row is never swept. A
    superseded source counts too (its row is gone but its object still renders),
    via :func:`_history_pinned_source_srcs`.

    Srcs the storage layer did not write (relative paths, dev external https)
    are left to the sanitiser.
    """
    storage = get_storage()
    own = {m.storage_url for m in event.media} | _history_pinned_source_srcs(db, event)
    foreign = sorted(
        src for src in displayed_srcs if src not in own and storage.key_from_url(src) is not None
    )
    if foreign:
        raise InvalidFileError("A proof image belongs to another event: " + ", ".join(foreign))


def _drop_unreferenced_proof_media(
    db: Session, event: Event, kept_srcs: set[str]
) -> tuple[list[str], int]:
    """Delete the ``proof`` media rows outside ``kept_srcs``.

    Returns ``(keys, dropped)``: the orphaned S3 keys and the deleted row count.
    They differ because a foreign ``storage_url`` resolves to no key.

    Rows only, staged in the caller's transaction; objects are swept after the
    commit, so a rollback never orphans a file a row still points at.
    """
    removed_keys: list[str] = []
    dropped = 0
    for m in list(event.media):
        if m.role != "proof" or m.storage_url in kept_srcs:
            continue
        removed_keys += _object_keys(
            m.storage_url, role=m.role, media_type=m.media_type, label=f"Media row {m.id}"
        )
        dropped += 1
        db.delete(m)
    return removed_keys, dropped


def prune_unreferenced_proof_media(db: Session, event: Event) -> tuple[list[str], int]:
    """Drop the proof rows nothing renders any more.

    Returns the ``(keys, dropped)`` pair of :func:`_drop_unreferenced_proof_media`.

    Standalone form of the diff in :func:`attach_evidence_and_commit`, for
    ``services/versions.redact_version``, which can leave an image no readable
    version or current body points at.

    Staged, not committed: the caller commits, then sweeps the keys.
    """
    kept = _displayed_proof_srcs(event.proof) | _history_pinned_srcs(db, event)
    return _drop_unreferenced_proof_media(db, event, kept)


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

    ``event`` must already be flushed (its id feeds the S3 keys and the
    ``Media`` FK), and the caller must delete AND flush any replaced ``source``
    rows first, so the partial unique index isn't tripped mid-flush.

    * ``source_files`` (0 or 1, the caller enforces it) land as
      ``Media(role='source')`` under ``uploads/<event>/``.
    * ``proof_doc`` is the sanitised incoming Tiptap document, or ``None`` to
      keep ``event.proof``. Its ``placeholder://`` srcs are matched to
      ``proof_files`` (see :func:`_match_proof_files`), uploaded without
      derivatives, rewritten to public URLs, and get ``Media(role='proof')``
      rows. Already-uploaded URLs pass through (the edit flow) and must name
      this event's own images (see :func:`_reject_foreign_proof_srcs`). Proof
      rows the final doc no longer shows, and no readable snapshot displays, are
      deleted and their objects swept post-commit.

    ``max_proof_images_per_event`` is checked twice before anything reaches S3:
    on ``proof_files`` alone (an over-ceiling batch should not cost a decode per
    file), then on what the final body displays, which bounds the event.

    Every file is validated up front so a bad file can't strand its siblings
    in S3. The commit is inside the try, so a commit failure also sweeps the
    orphaned objects; an ``IntegrityError`` on ``uq_media_source_per_event``
    becomes :class:`SourceMediaConflictError` (409).

    Raises :class:`TooManyFilesError` (the proof body would display more than
    ``max_proof_images_per_event`` images), :class:`InvalidFileError` (a file
    fails ``validate_file``, a non-image in ``proof_files``, or a proof src
    naming another event's stored image),
    :class:`ProofFilesMismatchError`, or
    :class:`EvidenceProcessingFailedError` (the uploader raises
    ``EvidenceProcessingError``).
    """
    if len(proof_files) > settings.max_proof_images_per_event:
        raise TooManyFilesError(
            f"At most {settings.max_proof_images_per_event} proof images per event; "
            f"this request carries {len(proof_files)}"
        )

    # Validate every file before any upload.
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

    # Before any S3 work: a mismatched batch is a 400 with nothing to sweep.
    proof_pairs = _match_proof_files(proof_doc, proof_files)

    # Diff against the FINAL doc (incoming, else the row's), plus history.
    final_doc = proof_doc if proof_doc is not None else event.proof
    displayed_srcs = _displayed_proof_srcs(final_doc)
    _reject_foreign_proof_srcs(db, event, displayed_srcs)
    kept_srcs = displayed_srcs | _history_pinned_srcs(db, event)

    # Cap what the new body displays (images it still shows plus new files).
    # The batch alone lets an event grow past the cap; counting kept rows
    # would charge for images pinned only by old versions.
    displayed_proof_rows = sum(
        1 for m in event.media if m.role == "proof" and m.storage_url in displayed_srcs
    )
    total_displayed = displayed_proof_rows + len(proof_files)
    if total_displayed > settings.max_proof_images_per_event:
        raise TooManyFilesError(
            f"At most {settings.max_proof_images_per_event} proof images per event; "
            f"this proof body would display {total_displayed} "
            f"({displayed_proof_rows} already uploaded, {len(proof_files)} new)"
        )

    removed_proof_keys, _dropped_proof_rows = _drop_unreferenced_proof_media(db, event, kept_srcs)
    # Flush deletes before the inserts so a same-URL re-add can't collide.
    db.flush()
    storage = get_storage()

    # Tracked so a mid-batch failure can sweep them on rollback.
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

        # Inside the try so a commit failure also sweeps orphans.
        db.commit()
    except IntegrityError as exc:
        # Explicit: a later query could autoflush the partially-added rows.
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

    # Best-effort. Proof uploads skip derivatives, so the key is the whole footprint.
    sweep_keys(removed_proof_keys, context=f"{sweep_context} (removed proof images)")


def _object_keys(storage_url: str, *, role: str, media_type: str, label: str) -> list[str]:
    """Every S3 key one media's storage URL owns, derivatives included.

    Hero / thumb derivatives exist only for ``source`` images. A foreign URL
    resolves to no key and is logged and skipped. ``label`` names the item in
    that log line.
    """
    key = get_storage().key_from_url(storage_url)
    if key is None:
        logger.warning("%s has unrecognised storage_url %s, skipping S3 delete", label, storage_url)
        return []
    if role != "source" or media_type != "image":
        return [key]
    return [key, derivative_key(key, "hero"), derivative_key(key, "thumb")]


def collect_media_keys(media_rows: list[Media]) -> list[str]:
    """S3 keys for a set of ``Media`` rows, derivatives included.

    Used by the admin hard delete and the GDPR erasures.
    """
    return [
        key
        for m in media_rows
        for key in _object_keys(
            m.storage_url, role=m.role, media_type=m.media_type, label=f"Media row {m.id}"
        )
    ]


def collect_snapshot_media_keys(entries: Iterable[Mapping[str, Any]]) -> list[str]:
    """S3 keys for a set of snapshot media fragments, derivatives included.

    The row-less twin of :func:`collect_media_keys`: an anchor swap deletes the
    replaced ``source`` row, so only the snapshot resolves those objects. An
    entry missing a needed field resolves to no key, like a foreign URL.
    """
    return [
        key
        for entry in entries
        if isinstance(entry.get("storage_url"), str)
        for key in _object_keys(
            cast(str, entry["storage_url"]),
            role=str(entry.get("role", "source")),
            media_type=str(entry.get("media_type", "")),
            label=f"Version media {entry.get('id')}",
        )
    ]


def collect_event_media_keys(db: Session, event: Event) -> list[str]:
    """Every S3 key deleting this event orphans: its media, and its history's.

    The snapshots add the superseded source objects, which outlive their row so
    ``/vN`` keeps rendering. Deduplicated, since an early version names media
    the row still carries.
    """
    keys = collect_media_keys(list(event.media))
    keys += collect_snapshot_media_keys(versions.referenced_source_media(db, event.id))
    return list(dict.fromkeys(keys))


def orphaned_source_media(
    db: Session, event: Event, *, dropped: Iterable[Mapping[str, Any]]
) -> list[Mapping[str, Any]]:
    """The superseded source media nothing renders any more.

    The source leg of a redaction, beside :func:`prune_unreferenced_proof_media`.
    ``dropped`` is the ``source_media`` fragment of the snapshot that stopped
    being readable. An entry survives while another readable version names it,
    the live row carries it, or the published proof body displays it; the rest
    are returned for sweeping. Call after the redaction is flushed. Resolve the
    objects via :func:`collect_snapshot_media_keys`.

    The proof-body keep is not redundant: a proof may cite the superseded
    source frame, and sweeping it would blank an image the published record
    renders.
    """
    kept = {m.storage_url for m in event.media}
    kept |= _displayed_proof_srcs(event.proof)
    kept |= {
        url
        for entry in versions.referenced_source_media(db, event.id)
        if isinstance(url := entry.get("storage_url"), str)
    }
    return [entry for entry in dropped if entry.get("storage_url") not in kept]
