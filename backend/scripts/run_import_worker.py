"""The archive-import worker: drain the job queues, forever.

The always-on Railway service behind ``POST /events/import-archive`` and the
X webhook: claims ``archive_import_jobs`` rows (``FOR UPDATE SKIP LOCKED``,
so a second worker is safe), runs the backfill off the API process, and
emails the owner the outcome (see ``services/archive_jobs``); each pass also
drains the ``bot_webhook_events`` queue through the shared mention pipeline
(see ``services/bot``), the webhook endpoint only inserts and this always-on
process is what answers the tag. Each drain pass opens a fresh session
(shared across that pass's jobs; per-job failure isolation is the rollback
inside ``process``), and a pass that dies outside job processing is captured
and retried with a backoff instead of killing the service.

The ``source_archives`` queue (published events' links, pushed to the Wayback
Machine, see ``services/source_archive``) drains on a **separate thread** with
its own session. Its cadence belongs to the archiving services rather than to
this loop: a pass paces its submissions with blocking sleeps and can run for
minutes, which inline would be minutes the import and mention queues spend
waiting behind a backfill instead of answering an analyst.

    uv run python scripts/run_import_worker.py

Also runnable with ``IMPORT_WORKER_ONCE=1`` for a single drain-and-exit pass
(useful by hand and for a cron fallback).
"""

import asyncio
import os
import sys
import threading
import time
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.config import settings
from app.database import SessionLocal
from app.services.archive_jobs import run_once
from app.services.bot import drain_webhook_events
from app.services.source_archive import run_once as archive_sources_once

_IDLE_SLEEP_SECONDS = 5.0
_ERROR_BACKOFF_SECONDS = 15.0
# Gap between two archival passes that found nothing. Longer than the import
# queue's idle sleep: a link becomes archivable when an event is published, not
# at the rate an analyst polls.
_ARCHIVAL_IDLE_SECONDS = 30.0


async def _drain_both(db) -> int:
    handled = await run_once(db)
    return handled + (await drain_webhook_events(db)).mentions_seen


def _drain() -> int:
    db = SessionLocal()
    try:
        return asyncio.run(_drain_both(db))
    finally:
        db.close()


def _drain_source_archives() -> int:
    """One source-archival pass on a session of its own.

    Its own session because it runs on its own thread: a SQLAlchemy session is
    not shared across threads.
    """
    db = SessionLocal()
    try:
        return archive_sources_once(db)
    finally:
        db.close()


def _archival_loop() -> None:
    """Drain the source-archival queue forever, on this thread.

    Separate from the pass above so a paced capture run never sits in front of
    an analyst's import or a bot mention. ``run_once`` blocks (the pacing and
    the status poll are ``time.sleep``), which is what this thread is for; the
    same call inline would block the event loop the other two queues run on.
    """
    while True:
        try:
            handled = _drain_source_archives()
        except Exception:  # noqa: BLE001
            # Same contract as the main loop: a pass that dies outside a row's
            # own handling must not take the thread down with it.
            sentry_sdk.capture_exception()
            time.sleep(_ERROR_BACKOFF_SECONDS)
            continue
        if handled == 0:
            time.sleep(_ARCHIVAL_IDLE_SECONDS)


def main() -> None:
    # Same opt-in Sentry boot as the app and the bot cron: a failing import is
    # durable (the job row lands ``failed``) but must page, not sit in logs.
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            send_default_pii=False,
        )

    if os.environ.get("IMPORT_WORKER_ONCE"):
        # Single-pass mode drains all three queues inline: there is no loop for
        # the archival thread to run alongside, and the caller wants the pass
        # finished when the process exits.
        handled = _drain() + _drain_source_archives()
        print(f"Import worker pass OK: {handled} job(s) / webhook mention(s) handled.")
        return

    # Daemon: the archival queue is durable, so a shutdown mid-pass costs at
    # most one row's stale window, and the process must not hang on this thread.
    threading.Thread(target=_archival_loop, name="source-archival", daemon=True).start()

    print("Import worker up; polling the queue.")
    while True:
        # A pass that dies OUTSIDE process() (claim_next on a transient DB
        # outage, session construction) must not kill the always-on service:
        # capture, back off, try again. Job-level failures are already landed
        # and captured inside run_once.
        try:
            handled = _drain()
        except Exception:  # noqa: BLE001
            sentry_sdk.capture_exception()
            time.sleep(_ERROR_BACKOFF_SECONDS)
            continue
        if handled == 0:
            time.sleep(_IDLE_SLEEP_SECONDS)


if __name__ == "__main__":
    main()
