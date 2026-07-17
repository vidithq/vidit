"""The archive-import worker: drain the job queue, forever.

The always-on Railway service behind ``POST /events/import-archive``: claims
``archive_import_jobs`` rows (``FOR UPDATE SKIP LOCKED``, so a second worker
is safe), runs the backfill off the API process, and emails the owner the
outcome (see ``services/archive_jobs``). Each drain pass opens a fresh
session (shared across that pass's jobs; per-job failure isolation is the
rollback inside ``process``), and a pass that dies outside job processing is
captured and retried with a backoff instead of killing the service.

    uv run python scripts/run_import_worker.py

Also runnable with ``IMPORT_WORKER_ONCE=1`` for a single drain-and-exit pass
(useful by hand and for a cron fallback).
"""

import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.config import settings
from app.database import SessionLocal
from app.services.archive_jobs import run_once

_IDLE_SLEEP_SECONDS = 5.0
_ERROR_BACKOFF_SECONDS = 15.0


def _drain() -> int:
    db = SessionLocal()
    try:
        return asyncio.run(run_once(db))
    finally:
        db.close()


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
        handled = _drain()
        print(f"Import worker pass OK: {handled} job(s) handled.")
        return

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
