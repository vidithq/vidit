"""The import worker: drain the job queues, forever.

The always-on worker role behind ``POST /events/import-archive`` and the X
bot: claims ``archive_import_jobs`` rows (``FOR UPDATE SKIP LOCKED``, so a
second worker is safe), runs the backfill off the API process and emails the
owner the outcome (``services/archive_jobs``). Each pass also drains the
``queued`` ``bot_mentions`` rows through the shared mention pipeline
(``services/bot``), and at start and every ``bot.CATCH_UP_INTERVAL`` pulls the
bot's mentions timeline to queue what the webhook missed, and deletes the staged
uploads past their expiry (``services/uploads``). Each pass first sends
the queued notification emails (``services/notification_delivery``). A queue
that raises is captured and skipped for the pass, so it never holds back the
others. Each pass opens a fresh session shared across its jobs (per-job
isolation is the rollback inside ``process``), and a pass that dies outside job
processing is captured and retried with a backoff. Before its first pass it
waits for the schema to reach the alembic head (``app/schema_gate``).
``IMPORT_WORKER_ONCE`` runs one pass and exits (useful by hand).
"""

import asyncio
import logging
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.observability import configure_logging, init_sentry
from app.schema_gate import wait_for_schema_head
from app.services import bot
from app.services.archive_jobs import run_once
from app.services.notification_delivery import drain as drain_notification_emails
from app.services.uploads import reap_expired_uploads

logger = logging.getLogger(__name__)

_IDLE_SLEEP_SECONDS = 5.0
_ERROR_BACKOFF_SECONDS = 15.0


async def _drain_both(db) -> int:
    handled = await run_once(db)
    mentions = await bot.drain_mentions(db)
    if mentions.mentions_processed:
        logger.info(
            "Bot drain: %d mentions, %d events created, %d detections updated, "
            "%d requests opened, %d replies posted, %d without detection, %d inheriting the "
            "tag, %d without a linked account, %d deduped, %d failed",
            mentions.mentions_processed,
            mentions.created_event_count,
            mentions.events_updated,
            mentions.requests_opened,
            mentions.replies_posted,
            mentions.no_detection,
            mentions.inherited,
            mentions.no_account,
            mentions.skipped,
            mentions.failed,
        )
    return handled + mentions.mentions_processed


def _isolated(drain: Callable[[Session], int], db: Session) -> int:
    """Run one queue's ``drain``; an error is captured and the pass goes on."""
    try:
        return drain(db)
    except Exception:  # noqa: BLE001
        sentry_sdk.capture_exception()
        db.rollback()
        return 0


def _catch_up(db: Session) -> int:
    """Queue the mentions the webhook missed; nothing when the bot is not configured."""
    if not bot.is_configured():
        return 0
    outcome = bot.catch_up(db)
    logger.info(
        "Bot catch-up: %d mentions seen, %d already queued",
        outcome.mentions_seen,
        outcome.already_handled,
    )
    return outcome.mentions_seen - outcome.already_handled


def _drain(*, catch_up: bool) -> int:
    db = SessionLocal()
    try:
        if catch_up:
            # On the catch-up cadence: a staged upload lives a day, so an hour late is nothing.
            _isolated(reap_expired_uploads, db)
        queued = _isolated(_catch_up, db) if catch_up else 0
        return queued + _isolated(drain_notification_emails, db) + asyncio.run(_drain_both(db))
    finally:
        db.close()


def main() -> None:
    configure_logging()
    # Same opt-in Sentry boot as the app: a failed import lands the job row
    # ``failed`` but must also page.
    init_sentry()
    wait_for_schema_head(engine)

    if os.environ.get("IMPORT_WORKER_ONCE"):
        handled = _drain(catch_up=True)
        print(
            f"Import worker pass OK: {handled} job(s) / mention(s) / notification email(s) handled."
        )
        return

    print("Import worker up; polling the queue.")
    next_catch_up = time.monotonic()
    while True:
        due = time.monotonic() >= next_catch_up
        if due:
            next_catch_up = time.monotonic() + bot.CATCH_UP_INTERVAL.total_seconds()
        # A pass dying outside process() (DB outage, session construction) must
        # not kill the service: capture, back off, retry. Job-level failures are
        # already landed and captured inside run_once.
        try:
            handled = _drain(catch_up=due)
        except Exception:  # noqa: BLE001
            sentry_sdk.capture_exception()
            time.sleep(_ERROR_BACKOFF_SECONDS)
            continue
        if handled == 0:
            time.sleep(_IDLE_SLEEP_SECONDS)


if __name__ == "__main__":
    main()
