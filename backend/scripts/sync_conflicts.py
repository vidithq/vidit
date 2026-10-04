"""Run one pass of the Wikipedia ongoing-conflicts sync.

For a daily scheduler (e.g. a Railway cron) or by hand. Exits non-zero when the
page could not be fetched or no longer matches the expected structure, writing
nothing (``services/conflict_sync``).
    uv run python scripts/sync_conflicts.py
"""

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sentry_sdk

from app.database import SessionLocal
from app.observability import configure_logging, init_sentry
from app.services.conflict_sync import ConflictSyncError, sync_conflicts


def main() -> None:
    configure_logging()
    # Same opt-in Sentry boot as the app: a changed page structure aborts every
    # run silently, so it must page.
    init_sentry()

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
