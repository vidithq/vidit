"""Shared evidence-intake orchestration: proof images, and the sweep of stored objects.

Every event write funnels its proof body through :func:`attach_evidence_and_commit`:
validate the proof images, upload them with key tracking, attach one ``Media`` row per image,
rewrite the body's ``placeholder://`` srcs, drop proof rows the body no longer references,
then commit-or-sweep. A source's file is not uploaded here: it is staged before the write
(``services/uploads``) and attached by ``services/events/sources``.

Proof images travel inside the multipart submit: the proof HTML references a not-yet-uploaded
file as ``placeholder://<filename>`` and the file arrives in ``proof_files``. Matching is by
sanitised original filename; a placeholder with no file, or a file no placeholder references,
is a 400 and nothing uploads.

Several ``media`` rows may name one stored object (a source added to another event is copied
by row, not by object), so a write never deletes an object outright: :func:`sweep_unreferenced`
deletes the ones no ``media`` row and no readable version still names, after the commit.

Errors are :class:`EvidenceIntakeError` subclasses with stable ``.code`` strings, mapped to
HTTP status by each router (seed map: :data:`EVIDENCE_INTAKE_ERROR_STATUS`). A service's own
domain errors subclass it, so a router catches one base.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from typing import Any, NamedTuple

from fastapi import UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.event import Event
from app.models.media import Media, MediaRole
from app.services import versions
from app.services.evidence_processing import EvidenceProcessingError
from app.services.sanitize import (
    PROOF_PLACEHOLDER_PREFIX,
    extract_image_srcs,
    rewrite_image_srcs,
)
from app.services.storage import (
    derivative_key,
    get_storage,
    safe_original_filename,
    sweep_keys,
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


class InvalidFileError(EvidenceIntakeError):
    code = "invalid_file"


class EvidenceProcessingFailedError(EvidenceIntakeError):
    code = "evidence_processing_failed"


class ProofFilesMismatchError(EvidenceIntakeError):
    """A ``placeholder://`` src with no matching upload, or vice versa."""

    code = "proof_files_mismatch"


# Each router spreads this, then adds its own domain codes.
EVIDENCE_INTAKE_ERROR_STATUS: dict[str, int] = {
    "too_many_files": 422,
    "invalid_file": 400,
    "evidence_processing_failed": 400,
    "proof_files_mismatch": 400,
}


class StoredObject(NamedTuple):
    """One stored file a sweep may delete: its URL, and whether derivatives sit beside it."""

    storage_url: str
    role: MediaRole
    kind: str


def media_objects(rows: Iterable[Media]) -> list[StoredObject]:
    return [StoredObject(m.storage_url, m.role, m.kind) for m in rows]


def snapshot_objects(entries: Iterable[Mapping[str, Any]]) -> list[StoredObject]:
    """The source files a set of snapshot media fragments name (``versions.media_entry``)."""
    return [
        StoredObject(entry["storage_url"], "source", str(entry.get("kind", "")))
        for entry in entries
        if isinstance(entry.get("storage_url"), str)
    ]


def event_objects(db: Session, event: Event) -> list[StoredObject]:
    """Every stored file the event names: its proof images, its sources' files, and the source
    files its readable history renders. Deduplicated by URL."""
    objects = media_objects(event.media)
    objects += media_objects(source.media for source in event.sources if source.media)
    objects += snapshot_objects(versions.referenced_source_media(db, event.id))
    return list({obj.storage_url: obj for obj in objects}.values())


def _object_keys(obj: StoredObject) -> list[str]:
    """Every storage key one object owns, derivatives included.

    Hero / thumb derivatives exist only for source images. A foreign URL resolves to no key
    and is logged and skipped.
    """
    key = get_storage().key_from_url(obj.storage_url)
    if key is None:
        logger.warning("Unrecognised storage_url %s, skipping the delete", obj.storage_url)
        return []
    if obj.role != "source" or obj.kind != "image":
        return [key]
    return [key, derivative_key(key, "hero"), derivative_key(key, "thumb")]


def unreferenced(db: Session, urls: Iterable[str]) -> set[str]:
    """The URLs among ``urls`` that no ``media`` row and no readable version's source names.

    Read after the commit that dropped the rows, so a copy on another event, or a version
    that still renders the file, keeps the object.
    """
    candidates = set(urls)
    if not candidates:
        return set()
    held = set(db.scalars(select(Media.storage_url).where(Media.storage_url.in_(candidates))).all())
    held |= set(
        db.scalars(
            text(
                "SELECT DISTINCT s.value -> 'media' ->> 'storage_url' FROM event_versions v "
                "CROSS JOIN LATERAL jsonb_array_elements("
                "COALESCE(v.snapshot -> 'sources', '[]'::jsonb)) s "
                "WHERE v.redacted_at IS NULL "
                "AND s.value -> 'media' ->> 'storage_url' = ANY(:urls)"
            ),
            {"urls": sorted(candidates)},
        ).all()
    )
    return candidates - held


def sweep_unreferenced(
    db: Session,
    objects: Iterable[StoredObject],
    *,
    context: str,
    keep: set[str] | None = None,
) -> None:
    """Delete the objects nothing names any more (:func:`unreferenced`), best-effort.

    Call after the commit. ``keep`` adds URLs to hold back, such as the images a proof body
    still displays.
    """
    by_url = {obj.storage_url: obj for obj in objects if obj.storage_url not in (keep or set())}
    free = unreferenced(db, by_url)
    sweep_keys(
        [key for url in by_url if url in free for key in _object_keys(by_url[url])],
        context=context,
    )


def _match_proof_files(
    proof_html: str | None, proof_files: list[UploadFile]
) -> list[tuple[str, UploadFile]]:
    """Pair each ``placeholder://<filename>`` src with its uploaded file.

    Strict both ways (an unmatched placeholder persists as a broken image, an
    unreferenced file as an untracked S3 object); runs before any upload.
    Returns ``(placeholder_src, file)`` pairs in document order.
    """
    placeholders = (
        [s for s in extract_image_srcs(proof_html) if s.startswith(PROOF_PLACEHOLDER_PREFIX)]
        if proof_html is not None
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
    unreferenced_files = set(files_by_name) - referenced
    if unreferenced_files:
        raise ProofFilesMismatchError(
            "Proof files not referenced by the proof body: " + ", ".join(sorted(unreferenced_files))
        )
    return pairs


def displayed_proof_srcs(proof: str) -> set[str]:
    """The already-uploaded image URLs a proof body displays (placeholders excluded)."""
    return {s for s in extract_image_srcs(proof) if not s.startswith(PROOF_PLACEHOLDER_PREFIX)}


def _history_pinned_srcs(db: Session, event: Event) -> set[str]:
    """The proof-image URLs this event's readable snapshots display.

    A proof image a past version still shows survives, row and object, after
    the current body drops it, so history stays renderable.

    An unpublished row (version 0) has no snapshot, so it pays no query.
    Precondition: ``services/versions.file_version`` has already bumped
    ``version_no`` and staged this write's snapshot, so the superseded
    version's images aren't swept by the same write.
    """
    if event.version_no == 0:
        return set()
    return versions.referenced_media_urls(db, event.id)


def _history_pinned_source_srcs(db: Session, event: Event) -> set[str]:
    """The source-file URLs this event's readable snapshots render."""
    if event.version_no == 0:
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
    resolves it) must be one of THIS event's files; otherwise event B could
    embed A's image and A's next edit would sweep it from under B.

    A proof body may cite one of the event's source files: only ``proof`` rows
    are diffed, so a cited source file is never dropped by the diff. A source
    file a past version renders counts too, via :func:`_history_pinned_source_srcs`.

    Srcs the storage layer did not write (relative paths, dev external https)
    are left to the sanitiser.
    """
    storage = get_storage()
    own = {m.storage_url for m in event.media}
    own |= {source.media.storage_url for source in event.sources if source.media is not None}
    own |= _history_pinned_source_srcs(db, event)
    foreign = sorted(
        src for src in displayed_srcs if src not in own and storage.key_from_url(src) is not None
    )
    if foreign:
        raise InvalidFileError("A proof image belongs to another event: " + ", ".join(foreign))


def _drop_unreferenced_proof_media(
    db: Session, event: Event, kept_srcs: set[str]
) -> list[StoredObject]:
    """Delete the ``proof`` media rows outside ``kept_srcs`` and return what they named.

    Rows only, staged in the caller's transaction; objects are swept after the
    commit, so a rollback never orphans a file a row still points at.
    """
    removed: list[StoredObject] = []
    for m in list(event.media):
        if m.storage_url in kept_srcs:
            continue
        removed.append(StoredObject(m.storage_url, "proof", m.kind))
        db.delete(m)
    return removed


def prune_unreferenced_proof_media(db: Session, event: Event) -> list[StoredObject]:
    """Drop the proof rows nothing renders any more and return what they named.

    Standalone form of the diff in :func:`attach_evidence_and_commit`, for
    ``services/versions.redact_version``, which can leave an image no readable
    version or current body points at.

    Staged, not committed: the caller commits, then sweeps.
    """
    kept = displayed_proof_srcs(event.proof) | _history_pinned_srcs(db, event)
    return _drop_unreferenced_proof_media(db, event, kept)


async def attach_evidence_and_commit(
    db: Session,
    *,
    event: Event,
    proof_html: str | None,
    proof_files: list[UploadFile],
    sweep_context: str,
    removed: list[StoredObject] | None = None,
) -> None:
    """Upload + attach an event's proof images, rewrite its proof body, commit, sweep.

    ``event`` must already be flushed (its id feeds the ``Media`` FK), and its sources already
    written (``services/events/sources.apply_sources``), whose dropped files arrive in
    ``removed``.

    ``proof_html`` is the sanitised incoming proof HTML, or ``None`` to keep ``event.proof``.
    Its ``placeholder://`` srcs are matched to ``proof_files`` (see :func:`_match_proof_files`),
    uploaded without derivatives, rewritten to public URLs, and get proof ``Media`` rows.
    Already-uploaded URLs pass through (the edit flow) and must name this event's own images
    (see :func:`_reject_foreign_proof_srcs`). Proof rows the final body no longer shows, and no
    readable snapshot displays, are deleted.

    ``max_proof_images_per_event`` is checked twice before anything reaches S3:
    on ``proof_files`` alone (an over-ceiling batch should not cost a decode per
    file), then on what the final body displays, which bounds the event.

    Every file is validated up front so a bad file can't strand its siblings in S3. The commit
    is inside the try, so a commit failure also sweeps the new objects. After the commit, the
    dropped proof images and ``removed`` are swept where nothing names them any more
    (:func:`sweep_unreferenced`), sparing what the final proof body displays.

    Raises :class:`TooManyFilesError` (the proof body would display more than
    ``max_proof_images_per_event`` images), :class:`InvalidFileError` (a non-image in
    ``proof_files``, or a proof src naming another event's stored image),
    :class:`ProofFilesMismatchError`, or :class:`EvidenceProcessingFailedError`.
    """
    if len(proof_files) > settings.max_proof_images_per_event:
        raise TooManyFilesError(
            f"At most {settings.max_proof_images_per_event} proof images per event; "
            f"this request carries {len(proof_files)}"
        )

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
    proof_pairs = _match_proof_files(proof_html, proof_files)

    # Diff against the FINAL body (incoming, else the row's), plus history.
    final_proof = proof_html if proof_html is not None else event.proof
    displayed_srcs = displayed_proof_srcs(final_proof)
    _reject_foreign_proof_srcs(db, event, displayed_srcs)
    kept_srcs = displayed_srcs | _history_pinned_srcs(db, event)

    # Cap what the new body displays (images it still shows plus new files).
    # The batch alone lets an event grow past the cap; counting kept rows
    # would charge for images pinned only by old versions.
    displayed_proof_rows = sum(1 for m in event.media if m.storage_url in displayed_srcs)
    total_displayed = displayed_proof_rows + len(proof_files)
    if total_displayed > settings.max_proof_images_per_event:
        raise TooManyFilesError(
            f"At most {settings.max_proof_images_per_event} proof images per event; "
            f"this proof body would display {total_displayed} "
            f"({displayed_proof_rows} already uploaded, {len(proof_files)} new)"
        )

    dropped = _drop_unreferenced_proof_media(db, event, kept_srcs)
    # Flush deletes before the inserts so a same-URL re-add can't collide.
    db.flush()
    storage = get_storage()

    # Tracked so a mid-batch failure can sweep them on rollback.
    uploaded_keys: list[str] = []
    try:
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
                    storage_url=result.url,
                    kind="image",
                    sha256=result.sha256,
                    original_filename=safe_original_filename(file.filename),
                )
            )
            key = storage.key_from_url(result.url)
            if key is not None:
                uploaded_keys.append(key)
                uploaded_keys.extend(result.derivative_keys)

        if proof_html is not None:
            event.proof = rewrite_image_srcs(proof_html, src_by_placeholder)

        # Inside the try so a commit failure also sweeps orphans.
        db.commit()
    except Exception:
        db.rollback()
        sweep_keys(uploaded_keys, context=sweep_context)
        raise

    sweep_unreferenced(
        db,
        dropped + (removed or []),
        context=f"{sweep_context} (removed files)",
        keep=displayed_proof_srcs(event.proof),
    )


def orphaned_source_media(
    db: Session, event: Event, *, dropped: Iterable[Mapping[str, Any]]
) -> list[Mapping[str, Any]]:
    """The source files of a redacted snapshot that nothing renders any more.

    The source leg of a redaction, beside :func:`prune_unreferenced_proof_media`.
    ``dropped`` is the media of the sources the snapshot held. An entry survives while another
    readable version or any ``media`` row names it (:func:`unreferenced`), or the event's proof
    body displays it; the rest are returned for sweeping. Call after the redaction is flushed.

    The proof-body keep is not redundant: a proof may cite the superseded
    source frame, and sweeping it would blank an image the published record
    renders.
    """
    entries = [entry for entry in dropped if isinstance(entry.get("storage_url"), str)]
    free = unreferenced(db, (entry["storage_url"] for entry in entries))
    free -= displayed_proof_srcs(event.proof)
    return [entry for entry in entries if entry["storage_url"] in free]


def sweep_snapshot_media(entries: Iterable[Mapping[str, Any]], *, context: str) -> None:
    """Delete the objects of snapshot media already known to be free (:func:`orphaned_source_media`)."""
    sweep_keys(
        [key for obj in snapshot_objects(entries) for key in _object_keys(obj)], context=context
    )
