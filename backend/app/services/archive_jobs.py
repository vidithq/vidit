"""The durable archive-import queue: enqueue at upload, drain in the worker.

A backfill never runs inside the request: unzip and parse take minutes and would freeze the
single-process event loop. The browser uploads the zip straight to storage under a presigned
POST (``/import-archive/presign`` mints the key), ``POST /events/import-archive`` verifies the
staged object and inserts an ``archive_import_jobs`` row, and the worker
(``scripts/run_import_worker.py``) claims rows with ``FOR UPDATE SKIP LOCKED``, runs the
backfill, stamps the counts, deletes the staged object and emails the owner. Postgres is the
queue: no broker, jobs survive restarts, and two workers can't double-run a job.

A worker killed mid-job leaves the row ``running``; a later pass reclaims it once
``started_at`` is older than ``STALE_RUNNING_AFTER``. A dedicated thread re-stamps
``started_at`` every ``HEARTBEAT_INTERVAL`` while the job runs (a thread, so beats land during
long synchronous stretches), so a long import never crosses the stale window while alive and a
reclaim never races a live run (e.g. overlapping workers in a rolling deploy). ``MAX_ATTEMPTS``
bounds the reclaim loop: a job that keeps dying lands ``failed``. The backfill is idempotent,
so a reclaimed half-applied run never duplicates rows.
"""

from __future__ import annotations

import logging
import re
import tempfile
import threading
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

import sentry_sdk
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.archive_import_job import ArchiveImportJob
from app.models.user import User
from app.services import email
from app.services.detection import backfill_from_archive
from app.services.storage import get_storage
from app.services.tweet_ingest import archive_zip

logger = logging.getLogger(__name__)

STAGING_PREFIX = "archive-imports/"
STALE_RUNNING_AFTER = timedelta(minutes=30)
# Liveness re-stamp cadence; far under the stale window so a live job can miss several beats.
HEARTBEAT_INTERVAL = timedelta(minutes=5)
MAX_ATTEMPTS = 3
# Progress stamp batch size: one UPDATE per this many handled detections (plus the final one).
PROGRESS_EVERY = 10


class StagedUploadError(Exception):
    """Base: the ``upload_key`` handed to the enqueue can't back a job.

    Abstract: every raise names a subclass, so the router's ``code`` map sees a concrete value.
    """

    code: str


class StagedUploadInvalidError(StagedUploadError):
    code = "archive_upload_invalid"


class StagedUploadMissingError(StagedUploadError):
    code = "archive_upload_missing"


class StagedUploadTooLargeError(StagedUploadError):
    code = "archive_too_large"


_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_STAGING_KEY_RE = re.compile(
    rf"^{re.escape(STAGING_PREFIX)}(?P<owner>{_UUID})/(?P<name>{_UUID})\.zip$"
)


def parse_staging_key(key: str) -> tuple[uuid.UUID, uuid.UUID] | None:
    """``(owner_id, object_id)`` for a well-formed staging key, else ``None``.

    The dev upload endpoint rebuilds its path from these parsed UUIDs, so no user-provided path
    fragment reaches the filesystem.
    """
    match = _STAGING_KEY_RE.fullmatch(key)
    if match is None:
        return None
    return uuid.UUID(match.group("owner")), uuid.UUID(match.group("name"))


def mint_staging_key(owner_id: uuid.UUID) -> str:
    """A fresh staging key for one presigned upload, bound to its owner.

    :func:`verify_staged_upload` accepts only keys under the caller's own segment, so a crafted
    foreign key can't enqueue someone else's object. No minted-key table or signed token needed.
    """
    return f"{STAGING_PREFIX}{owner_id}/{uuid.uuid4()}.zip"


def verify_staged_upload(key: str, *, owner_id: uuid.UUID) -> int:
    """Gate an enqueue's ``upload_key``: shape, ownership, presence, size.

    Returns the staged object's byte size; raises a typed :class:`StagedUploadError`. Does a
    storage HEAD, so callers on the event loop run it in a thread.
    """
    match = _STAGING_KEY_RE.fullmatch(key)
    if match is None or match.group("owner") != str(owner_id):
        raise StagedUploadInvalidError("upload_key is not a staging key of yours")
    size = get_storage().head_size(key)
    if size is None:
        raise StagedUploadMissingError("No uploaded object at upload_key")
    if size > archive_zip.MAX_UPLOAD_BYTES:
        raise StagedUploadTooLargeError("Staged archive exceeds the size guard")
    return size


def enqueue(
    db: Session, *, owner: User, upload_key: str, post_estimate: int | None = None
) -> ArchiveImportJob:
    """Insert the ``queued`` row for an already-staged upload.

    The caller has run :func:`verify_staged_upload`. ``post_estimate`` is the browser's cosmetic
    volume hint; the worker stamps the exact totals.
    """
    # One key, one job: a retry would otherwise create a second row over the same object, and
    # the first job's terminal delete would fail the second with a spurious "missing" email.
    if db.query(ArchiveImportJob.id).filter(ArchiveImportJob.zip_key == upload_key).first():
        raise StagedUploadInvalidError("upload_key is already enqueued")
    job = ArchiveImportJob(
        id=uuid.uuid4(), owner_id=owner.id, zip_key=upload_key, post_estimate=post_estimate
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim_next(db: Session) -> ArchiveImportJob | None:
    """Claim the oldest runnable job, or ``None`` when the queue is drained.

    Runnable: ``queued``, or ``running`` past the stale window (a worker died mid-job). The
    commit publishes the ``running`` stamp and releases the row lock; the work runs unlocked
    and the stale window guards a crash after this point.
    """
    while True:
        now = datetime.now(UTC)
        job = (
            db.query(ArchiveImportJob)
            .filter(
                or_(
                    ArchiveImportJob.status == "queued",
                    (ArchiveImportJob.status == "running")
                    & (ArchiveImportJob.started_at < now - STALE_RUNNING_AFTER),
                )
            )
            .order_by(ArchiveImportJob.created_at)
            .with_for_update(skip_locked=True)
            .first()
        )
        if job is None:
            return None
        if job.attempts >= MAX_ATTEMPTS:
            # Bury the poison row and keep looking (a loop, so a big backlog can't deepen the
            # stack).
            _finish(db, job, status="failed", error="attempt budget spent")
            _notify_failure_best_effort(db, job)
            continue
        job.status = "running"
        job.attempts += 1
        job.started_at = now
        db.commit()
        db.refresh(job)
        return job


def _heartbeat_loop(job_id: uuid.UUID, stop: threading.Event) -> None:
    """Re-stamp ``started_at`` every ``HEARTBEAT_INTERVAL`` until ``stop``.

    A plain thread: the backfill's long synchronous stretches starve the event loop, and a
    starved loop must not read as a dead worker. Each beat uses its own short-lived session
    (the processing session is busy in the backfill transaction). A failed beat is logged and
    retried next tick, never fatal.
    """
    while not stop.wait(HEARTBEAT_INTERVAL.total_seconds()):
        hb = SessionLocal()
        try:
            hb.query(ArchiveImportJob).filter(ArchiveImportJob.id == job_id).update(
                {"started_at": datetime.now(UTC)}, synchronize_session=False
            )
            hb.commit()
        except Exception:  # noqa: BLE001
            logger.warning("archive import heartbeat failed for job %s", job_id)
        finally:
            hb.close()


async def process(db: Session, job: ArchiveImportJob) -> None:
    """Run one claimed job to a terminal state.

    Downloads the staged zip, extracts it under the hardened allowlist, runs the backfill as the
    job's owner, stamps the counts and emails. A failure lands the row ``failed`` with the
    reason, notifies the owner and re-raises for the caller's Sentry capture. The staged object
    is deleted on both outcomes.
    """
    # The liveness ``detection.linked_owner`` requires: a soft-deleted or deactivated account's
    # work is hidden or suspended, so a job queued before the suspension must not land
    # detections under it.
    owner = db.get(User, job.owner_id)
    if owner is None or owner.deleted_at is not None or not owner.is_active:
        _finish(db, job, status="failed", error="owner gone")
        return
    # Imported under the owner's linked handle: provenance permalinks and the own-status
    # exclusion are written from it. No fallback onto the username, which would fabricate links
    # to an account that may be someone else's.
    if owner.x_handle is None:
        _finish(db, job, status="failed", error="owner has no linked X handle")
        _notify_failure_best_effort(db, job)
        return

    # Re-check the enqueue's HEAD gate: the presign window stays open ~15 min after enqueue, so
    # the object can have been replaced or deleted. Fail here rather than buffer an over-guard
    # object.
    size = get_storage().head_size(job.zip_key)
    if size is None:
        _finish(db, job, status="failed", error="staged object missing")
        _notify_failure_best_effort(db, job)
        return
    if size > archive_zip.MAX_UPLOAD_BYTES:
        _finish(db, job, status="failed", error="staged object oversized")
        _notify_failure_best_effort(db, job)
        return

    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(target=_heartbeat_loop, args=(job.id, stop_heartbeat), daemon=True)
    heartbeat.start()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            zip_path = tmp_path / "upload.zip"
            archive_dir = tmp_path / "archive"
            archive_dir.mkdir()
            # Streamed, never buffered: a staged zip can approach the 4 GB guard.
            get_storage().get_to_path(job.zip_key, zip_path)
            archive_zip.extract_allowlisted(zip_path, archive_dir)

            def stamp_progress(done: int, total: int) -> None:
                # Fires between per-row transactions, so the commit never splits one. Batched.
                if done == total or done == 1 or done % PROGRESS_EVERY == 0:
                    job.progress_done = done
                    job.progress_total = total
                    db.commit()

            outcome = await backfill_from_archive(
                db, owner=owner, archive_dir=archive_dir, chase=True, on_progress=stamp_progress
            )
    except Exception as exc:
        db.rollback()
        logger.exception("archive import job %s failed", job.id)
        # Land the terminal state on a FRESH session: if the DB connection itself failed, the
        # processing session may be beyond rollback. The stored reason stays a terse class name;
        # the log line and Sentry capture hold the rest.
        fs = SessionLocal()
        try:
            fs_job = fs.get(ArchiveImportJob, job.id)
            if fs_job is not None:
                _finish(fs, fs_job, status="failed", error=type(exc).__name__)
                _notify_failure_best_effort(fs, fs_job)
        finally:
            fs.close()
        raise
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=5)
    job.created_count = len(outcome.created)
    job.updated_count = len(outcome.updated)
    job.skipped_count = len(outcome.skipped)
    job.failed_count = outcome.failed
    _finish(db, job, status="done")
    if owner.email is None:
        return
    _send_best_effort(
        email.archive_import_complete_email(
            to=owner.email,
            created=job.created_count,
            updated=job.updated_count,
            skipped=job.skipped_count,
            failed=job.failed_count,
            warnings=outcome.warnings,
            detections_link=email.detections_link(owner.username),
        )
    )


def _finish(
    db: Session,
    job: ArchiveImportJob,
    *,
    status: Literal["done", "failed"],
    error: str | None = None,
) -> None:
    job.status = status
    job.error = error
    job.finished_at = datetime.now(UTC)
    db.commit()
    _delete_staged_best_effort(job.zip_key)


def _delete_staged_best_effort(key: str) -> None:
    # A leaked staging object is bounded (one capped zip) and visible under the prefix; never
    # let cleanup mask the job outcome.
    try:
        get_storage().delete_many([key])
    except Exception:  # noqa: BLE001
        logger.warning("could not delete staged archive %s", key)


def _notify_failure_best_effort(db: Session, job: ArchiveImportJob) -> None:
    owner = db.get(User, job.owner_id)
    if owner is None or owner.deleted_at is not None or owner.email is None:
        return
    _send_best_effort(email.archive_import_failed_email(to=owner.email))


def _send_best_effort(message: email.Email) -> None:
    # The durable outcome is the job row: a mailer outage must not fail or re-run the import.
    try:
        email.send(message)
    except email.EmailSendError as exc:
        logger.warning("archive import email send failed: %s", exc)


async def run_once(db: Session) -> int:
    """Drain the queue: claim and process until empty; return jobs handled."""
    handled = 0
    while (job := claim_next(db)) is not None:
        try:
            await process(db, job)
        except Exception:  # noqa: BLE001
            # ``process`` already landed the row and notified. Keep draining: one bad archive
            # must not starve the queue.
            sentry_sdk.capture_exception()
        handled += 1
    return handled
