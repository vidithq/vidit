"""Run one reconciliation pass of the @ViditBot mention pipeline.

The hourly net behind the Account Activity webhook (the nominal delivery
path, see ``routers/webhooks``): pulls the bot's new mentions and catches
anything the webhook dropped, running each through the same pipeline
(``services/bot``); a mention the webhook already handled just counts
``already handled``, and while ``X_WEBHOOK_ENABLED`` is true a fresh one
pages as a webhook gap. Meant for a scheduler (e.g. a Railway cron), and
runnable by hand. Exits non-zero when the pass could not start (missing
credentials, mentions pull failed); per-mention failures are recorded and
counted, not fatal.

    uv run python scripts/run_bot.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.config import settings
from app.database import SessionLocal
from app.services.bot import BotNotConfigured, run_bot_once
from app.services.x_api import XApiError


def main() -> None:
    # Same opt-in Sentry boot as the app: a failing pull (revoked token,
    # pricing change, API drift) is silent and durable, so it must page
    # rather than sit in the cron service's logs.
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            send_default_pii=False,
        )

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
        f"{result.replies_posted} replies posted, "
        f"{result.likes_posted} likes posted, "
        f"{result.no_detection} without detection, "
        f"{result.no_account} without a linked account, "
        f"{result.skipped} deduped, {result.already_handled} already handled, "
        f"{result.failed} failed."
    )
    if result.failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
