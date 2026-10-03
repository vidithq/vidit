from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# How long an API statement waits for a lock another transaction holds before
# Postgres cancels it. Applied by ``bound_lock_waits``, which only the API calls.
LOCK_TIMEOUT_MS = 5000

engine = create_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,
    pool_recycle=3600,
    # Error text leaves out bound parameters (password hashes, emails), so
    # they never reach logs or Sentry.
    hide_parameters=True,
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def bound_lock_waits() -> None:
    """Start every connection ``engine`` opens with ``lock_timeout`` at ``LOCK_TIMEOUT_MS``.

    ``main.py`` calls this at import: a request queued on a lock holds one of the
    API's threadpool workers, so its wait has to end. The scheduler services
    share the engine without calling it, and wait. The setting rides in the
    startup ``options`` rather than a ``SET`` in a ``connect`` listener, which
    psycopg2's implicit transaction and the pool's reset rollback would undo.
    Pooled connections opened before the call are dropped, so none escapes it.
    """
    event.listen(engine, "do_connect", _add_lock_timeout)
    engine.dispose()


def _add_lock_timeout(_dialect: Any, _conn_rec: Any, _cargs: Any, cparams: dict[str, Any]) -> None:
    options = cparams.get("options", "")
    cparams["options"] = f"{options} -c lock_timeout={LOCK_TIMEOUT_MS}".strip()
