"""The import worker: drain the job queues, forever.

The always-on worker role behind ``POST /events/import-archive`` and the X
bot: claims ``archive_import_jobs`` rows (``FOR UPDATE SKIP LOCKED``, so a
second worker is safe), runs the backfill off the API process and emails the
owner the outcome (``services/archive_jobs``). Each pass also drains the
``queued`` ``bot_mentions`` rows through the shared mention pipeline
(``services/bot``). At start and then every hour it deletes the staged uploads
past their expiry (``services/uploads``) and, when the last stored pull is
``bot.CATCH_UP_INTERVAL`` old, pulls the bot's mentions timeline to queue what
the webhook missed. Each pass first sends the queued notification emails
(``services/notification_delivery``). A queue that raises is captured and
skipped for the pass, so it never holds back the others. Each pass opens a
fresh session shared across its jobs (per-job isolation is the rollback inside
``process``), and a pass that dies outside job processing is captured and
retried with a backoff. Before its first pass it
waits for the schema to reach the alembic head (``app/schema_gate``).
``IMPORT_WORKER_ONCE`` runs one pass with a forced mentions pull and exits
(useful by hand).
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
# The reaper's cadence, and how often the worker checks whether the catch-up is due.
_HOURLY_SECONDS = 3600.0


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


def _catch_up(db: Session, *, force: bool) -> int:
    """Queue the mentions the webhook missed when a pull is due, or ``force``d; nothing when
    the bot is not configured."""
    if not bot.is_configured() or not (force or bot.catch_up_due(db)):
        return 0
    outcome = bot.catch_up(db)
    logger.info("Bot catch-up: %d mentions seen, %d queued", outcome.mentions_seen, outcome.queued)
    return outcome.queued


def _drain(*, hourly: bool, force_catch_up: bool = False) -> int:
    db = SessionLocal()
    try:
        queued = 0
        if hourly:
            # A staged upload lives a day, so an hour late is nothing.
            _isolated(reap_expired_uploads, db)
            queued = _isolated(lambda session: _catch_up(session, force=force_catch_up), db)
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
        handled = _drain(hourly=True, force_catch_up=True)
        print(
            f"Import worker pass OK: {handled} job(s) / mention(s) / notification email(s) handled."
        )
        return

    print("Import worker up; polling the queue.")
    next_hourly = time.monotonic()
    while True:
        due = time.monotonic() >= next_hourly
        if due:
            next_hourly = time.monotonic() + _HOURLY_SECONDS
        # A pass dying outside process() (DB outage, session construction) must
        # not kill the service: capture, back off, retry. Job-level failures are
        # already landed and captured inside run_once.
        try:
            handled = _drain(hourly=due)
        except Exception:  # noqa: BLE001
            sentry_sdk.capture_exception()
            time.sleep(_ERROR_BACKOFF_SECONDS)
            continue
        if handled == 0:
            time.sleep(_IDLE_SLEEP_SECONDS)


if __name__ == "__main__":
    main()
