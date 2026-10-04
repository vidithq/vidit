"""Run one reconciliation pass of the @ViditBot mention pipeline.

The hourly net behind the Account Activity webhook (``routers/webhooks``):
pulls the bot's new mentions and catches anything the webhook dropped, through
the same pipeline (``services/bot``). A mention the webhook already handled
counts ``already handled``; while ``X_WEBHOOK_ENABLED`` is true a fresh one
pages as a webhook gap. For a scheduler (e.g. a Railway cron) or by hand. Exits
non-zero when the pass could not start (missing credentials, pull failed);
per-mention failures are recorded and counted, not fatal.
"""

import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.database import SessionLocal
from app.observability import configure_logging, init_sentry
from app.services.bot import BotNotConfigured, run_bot_once
from app.services.x_api import XApiError


def main() -> None:
    configure_logging()
    # Same opt-in Sentry boot as the app: a failing pull (revoked token, API
    # drift) is silent and durable, so it must page.
    init_sentry()

    db = SessionLocal()
    try:
        result = asyncio.run(run_bot_once(db))
    except BotNotConfigured as exc:
        raise SystemExit(f"bot not configured: {exc}") from exc
    except XApiError as exc:
        sentry_sdk.capture_exception(exc)
        raise SystemExit(f"bot pass aborted, mentions pull failed: {exc}") from exc
    finally:
        db.close()

    print(
        f"Bot reconciliation pass OK: {result.mentions_seen} mentions seen, "
        f"{result.events_created} events created, "
        f"{result.events_updated} mentions updating a detection, "
        f"{result.requests_opened} requests opened, "
        f"{result.replies_posted} replies posted, "
        f"{result.no_detection} without detection, "
        f"{result.inherited} inheriting the tag from a parent, "
        f"{result.no_account} without a linked account, "
        f"{result.skipped} deduped, {result.already_handled} already handled, "
        f"{result.failed} failed."
    )
    if result.failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
