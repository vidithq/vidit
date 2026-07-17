"""The durable archive-import queue: enqueue at upload, drain in the worker.

``POST /events/import-archive`` used to run the whole backfill inside the
request; a large export held its response open for minutes and its unzip +
parse froze the single-process event loop. Now the endpoint stages the zip to
storage and inserts an ``archive_import_jobs`` row; the worker service
(``scripts/run_import_worker.py``) claims rows with ``FOR UPDATE SKIP LOCKED``,
runs the same backfill, stamps the counts, deletes the staged object, and
emails the owner. Postgres is the queue: no broker, jobs survive API and
worker restarts, and two worker processes can't double-run a job.

A worker killed mid-job leaves the row ``running``; a later pass reclaims it
once ``started_at`` is older than ``STALE_RUNNING_AFTER``. ``MAX_ATTEMPTS``
bounds the reclaim loop: a job that keeps dying lands ``failed`` (poison-pill
guard, e.g. an archive that OOMs the worker every time). The backfill itself
is idempotent (re-import skips existing pairs), so a reclaimed half-applied
run never duplicates rows.
"""

from __future__ import annotations

import logging
import tempfile
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

import sentry_sdk
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.models.archive_import_job import ArchiveImportJob
from app.models.user import User
from app.services import email
from app.services.detection import backfill_from_archive
from app.services.storage import get_storage
from app.services.tweet_ingest import archive_zip

logger = logging.getLogger(__name__)

STAGING_PREFIX = "archive-imports/"
STALE_RUNNING_AFTER = timedelta(minutes=30)
MAX_ATTEMPTS = 3


def staging_key(job_id: uuid.UUID) -> str:
    return f"{STAGING_PREFIX}{job_id}.zip"


def enqueue(db: Session, *, owner: User, zip_bytes: bytes) -> ArchiveImportJob:
    """Stage the validated upload and insert its ``queued`` row.

    The zip was already streamed to disk under ``MAX_UPLOAD_BYTES`` and passed
    :func:`archive_zip.inspect_archive`, so everything staged here is worth a
    worker pass. Staging happens before the insert: a row without its object
    would fail the worker, an object without its row is a harmless orphan
    under the bounded upload cap.
    """
    # Mint the id up front (the column default only fires at flush): the
    # staging key embeds it, and staging must precede the insert.
    job_id = uuid.uuid4()
    job = ArchiveImportJob(id=job_id, owner_id=owner.id, zip_key=staging_key(job_id))
    get_storage().put_bytes_sync(zip_bytes, job.zip_key, "application/zip")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim_next(db: Session) -> ArchiveImportJob | None:
    """Claim the oldest runnable job, or ``None`` when the queue is drained.

    Runnable: ``queued``, or ``running`` with a ``started_at`` past the stale
    window (a worker died mid-job). ``FOR UPDATE SKIP LOCKED`` makes the claim
    safe under concurrent workers; the commit below publishes the ``running``
    stamp and releases the row lock (the work itself runs unlocked, the stale
    window is what guards a crash after this point).
    """
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
        _finish(db, job, status="failed", error="attempt budget spent")
        _notify_failure_best_effort(db, job)
        return claim_next(db)
    job.status = "running"
    job.attempts += 1
    job.started_at = now
    db.commit()
    db.refresh(job)
    return job


async def process(db: Session, job: ArchiveImportJob) -> None:
    """Run one claimed job to a terminal state.

    Downloads the staged zip, extracts under the same hardened allowlist as
    before, runs the backfill attributed to the job's owner, stamps the
    counts, and emails. A failure lands the row ``failed`` with the reason,
    notifies the owner, and re-raises for the caller's Sentry capture; the
    staged object is deleted on both outcomes.
    """
    owner = db.get(User, job.owner_id)
    if owner is None or owner.deleted_at is not None:
        _finish(db, job, status="failed", error="owner gone")
        return

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            zip_path = tmp_path / "upload.zip"
            archive_dir = tmp_path / "archive"
            archive_dir.mkdir()
            zip_path.write_bytes(get_storage().get_bytes(job.zip_key))
            archive_zip.extract_allowlisted(zip_path, archive_dir)
            outcome = await backfill_from_archive(
                db, owner=owner, archive_dir=archive_dir, chase=True
            )
    except Exception as exc:
        db.rollback()
        logger.exception("archive import job %s failed", job.id)
        _finish(db, job, status="failed", error=f"{type(exc).__name__}: {exc}")
        _notify_failure_best_effort(db, job)
        raise
    job.created_count = len(outcome.created)
    job.skipped_count = outcome.skipped
    job.recreated_count = outcome.recreated
    job.failed_count = outcome.failed
    _finish(db, job, status="done")
    if owner.email is None:
        return
    _send_best_effort(
        email.archive_import_complete_email(
            to=owner.email,
            created=job.created_count,
            skipped=job.skipped_count,
            recreated=job.recreated_count,
            failed=job.failed_count,
            detections_link=f"{settings.frontend_url.rstrip('/')}/profile/{owner.username}/detections",
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
    # A leaked staging object is bounded (one capped zip) and visible under the
    # prefix; never let cleanup mask the job outcome.
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
    # Same contract as the auth mailers: the durable outcome is the job row,
    # a mailer outage must not fail (or re-run) the import.
    try:
        email.send(message)
    except email.EmailSendError as exc:
        logger.warning("archive import email send failed: %s", exc)


async def run_once(db: Session) -> int:
    """Drain the queue: claim + process until empty; return jobs handled.

    The worker loop calls this forever with a sleep between empty passes;
    tests call it once to run an enqueued import synchronously.
    """
    handled = 0
    while (job := claim_next(db)) is not None:
        try:
            await process(db, job)
        except Exception:  # noqa: BLE001
            # ``process`` already landed the row + notified. Capture and keep
            # draining: one bad archive must not starve the queue behind it.
            sentry_sdk.capture_exception()
        handled += 1
    return handled
