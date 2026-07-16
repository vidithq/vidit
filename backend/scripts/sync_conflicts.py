"""Run one pass of the Wikipedia ongoing-conflicts sync.

Meant for a daily scheduler (e.g. a Railway cron), and runnable by hand.
Exits non-zero when the page could not be fetched or no longer matches the
expected structure; in that case nothing was written (see
``services/conflict_sync``).

    uv run python scripts/sync_conflicts.py
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.config import settings
from app.database import SessionLocal
from app.services.conflict_sync import ConflictSyncError, sync_conflicts


def main() -> None:
    # Same opt-in Sentry boot as the app: the interesting failure mode (the
    # page structure changed and every run aborts) is silent and durable, so
    # it must page rather than sit in the cron service's logs.
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            send_default_pii=False,
        )

    db = SessionLocal()
    try:
        result = sync_conflicts(db)
    except ConflictSyncError as exc:
        sentry_sdk.capture_exception(exc)
        raise SystemExit(f"conflict sync aborted, nothing written: {exc}") from exc
    finally:
        db.close()

    print(
        f"Sync OK: {result.seen} on page, {result.created} created, "
        f"{result.renamed} renamed, {result.adopted} adopted, "
        f"{result.reactivated} reactivated, {result.deactivated} deactivated."
    )
    for reason in result.skipped:
        print(f"  skipped: {reason}")


if __name__ == "__main__":
    main()
