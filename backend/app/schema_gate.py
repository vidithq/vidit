"""Hold a scheduler service until the database schema reaches the alembic head.

Only the API runs ``alembic upgrade head`` (its Railway pre-deploy), and the
scheduler services deploy the same commit in parallel, so a worker can start on
new code against the old schema. A database ahead of the code (a revision the
scripts do not know) passes, so a rollback deploy is never held.
"""

import logging
import time
from collections.abc import Callable
from pathlib import Path

import sentry_sdk
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

_BACKEND = Path(__file__).resolve().parents[1]
POLL_SECONDS = 5.0
TIMEOUT_SECONDS = 600.0


def script_directory() -> ScriptDirectory:
    config = Config(str(_BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND / "alembic"))
    return ScriptDirectory.from_config(config)


def _db_revision(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def wait_for_schema_head(
    engine: Engine,
    *,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> None:
    script = script_directory()
    head = script.get_current_head()
    known = {rev.revision for rev in script.walk_revisions()}
    deadline = clock() + TIMEOUT_SECONDS
    while True:
        current = _db_revision(engine)
        if current == head or (current is not None and current not in known):
            return
        if clock() >= deadline:
            # Exit rather than proceed: new code on the old schema is the error
            # burst this gate stops, and Railway's ON_FAILURE policy restarts us.
            sentry_sdk.capture_message(
                f"schema still at {current}, head is {head}, after {TIMEOUT_SECONDS:.0f}s"
            )
            raise SystemExit(f"schema still at {current}, head is {head}; giving up")
        logger.info("Waiting for migrations: schema at %s, head is %s", current, head)
        sleep(POLL_SECONDS)
