"""The import worker: drain the job queues, forever (``docs/engineering.md``, Scheduler services)."""

import asyncio
import logging
import os
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
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
_HOURLY = timedelta(hours=1)


async def _drain_both(db) -> int:
    handled = await run_once(db)
    mentions = await bot.drain_mentions(db)
    if mentions.mentions_processed:
        logger.info(
            "Bot drain: %d mentions, %d events created, %d replies posted, outcomes %s",
            mentions.mentions_processed,
            mentions.created_event_count,
            mentions.replies_posted,
            dict(mentions.outcomes),
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


class _Cadence:
    """Which passes reap and which check the catch-up, from the wall clock alone.

    The catch-up check reads the stored pull, so it runs on the hourly tick and
    when the clock passes the next slot, never on every pass. The hourly check
    retries a pull that failed and covers a clock that jumped.
    """

    def __init__(self, now: datetime) -> None:
        self._next_hourly = now
        self._next_slot = now

    def tick(self, now: datetime) -> tuple[bool, bool]:
        """Whether this pass reaps, and whether it checks the catch-up."""
        hourly = now >= self._next_hourly
        if hourly:
            self._next_hourly = now + _HOURLY
        slot = now >= self._next_slot
        if slot:
            self._next_slot = bot.next_catch_up_slot(now)
        return hourly, hourly or slot


def _drain(*, reap: bool, catch_up: bool, force_catch_up: bool = False) -> int:
    db = SessionLocal()
    try:
        queued = 0
        if reap:
            # A staged upload lives a day, so an hour late is nothing.
            _isolated(reap_expired_uploads, db)
        if catch_up:
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
        handled = _drain(reap=True, catch_up=True, force_catch_up=True)
        print(
            f"Import worker pass OK: {handled} job(s) / mention(s) / notification email(s) handled."
        )
        return

    print("Import worker up; polling the queue.")
    cadence = _Cadence(datetime.now(UTC))
    while True:
        reap, catch_up = cadence.tick(datetime.now(UTC))
        # A pass dying outside process() (DB outage, session construction) must
        # not kill the service: capture, back off, retry. Job-level failures are
        # already landed and captured inside run_once.
        try:
            handled = _drain(reap=reap, catch_up=catch_up)
        except Exception:  # noqa: BLE001
            sentry_sdk.capture_exception()
            time.sleep(_ERROR_BACKOFF_SECONDS)
            continue
        if handled == 0:
            time.sleep(_IDLE_SLEEP_SECONDS)


if __name__ == "__main__":
    main()
