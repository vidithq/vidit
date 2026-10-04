"""The archive-import worker: drain the job queues, forever.

The always-on Railway service behind ``POST /events/import-archive`` and the X
webhook: claims ``archive_import_jobs`` rows (``FOR UPDATE SKIP LOCKED``, so a
second worker is safe), runs the backfill off the API process and emails the
owner the outcome (``services/archive_jobs``). Each pass also drains
``bot_webhook_events`` through the shared mention pipeline (``services/bot``);
the webhook endpoint only inserts. Each pass opens a fresh session shared
across its jobs (per-job isolation is the rollback inside ``process``), and a
pass that dies outside job processing is captured and retried with a backoff.
(useful by hand and for a cron fallback).
"""

import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.database import SessionLocal
from app.observability import configure_logging, init_sentry
from app.services.archive_jobs import run_once
from app.services.bot import drain_webhook_events

_IDLE_SLEEP_SECONDS = 5.0
_ERROR_BACKOFF_SECONDS = 15.0


async def _drain_both(db) -> int:
    handled = await run_once(db)
    return handled + (await drain_webhook_events(db)).mentions_seen


def _drain() -> int:
    db = SessionLocal()
    try:
        return asyncio.run(_drain_both(db))
    finally:
        db.close()


def main() -> None:
    configure_logging()
    # Same opt-in Sentry boot as the app and bot cron: a failed import lands the
    # job row ``failed`` but must also page.
    init_sentry()

    if os.environ.get("IMPORT_WORKER_ONCE"):
        handled = _drain()
        print(f"Import worker pass OK: {handled} job(s) / webhook mention(s) handled.")
        return

    print("Import worker up; polling the queue.")
    while True:
        # A pass dying outside process() (DB outage, session construction) must
        # not kill the service: capture, back off, retry. Job-level failures are
        # already landed and captured inside run_once.
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
