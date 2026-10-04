from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# How long an API statement waits on another transaction's lock before Postgres
# cancels it (applied by ``bound_lock_waits``).
LOCK_TIMEOUT_MS = 5000

engine = create_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,
    pool_recycle=3600,
    # Errors omit bound parameters (hashes, emails) so they stay out of logs and Sentry.
    hide_parameters=True,
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def bound_lock_waits() -> None:
    """Start every connection ``engine`` opens with ``lock_timeout`` at ``LOCK_TIMEOUT_MS``.

    Only the API calls it (``main.py``, at import): a request queued on a lock
    holds a threadpool worker. Scheduler services share the engine and wait.
    The setting rides in the startup ``options`` because a ``SET`` in a
    ``connect`` listener would be undone by psycopg2's implicit transaction and
    the pool's reset rollback. Earlier pooled connections are dropped.
    """
    event.listen(engine, "do_connect", _add_lock_timeout)
    engine.dispose()


def _add_lock_timeout(_dialect: Any, _conn_rec: Any, _cargs: Any, cparams: dict[str, Any]) -> None:
    options = cparams.get("options", "")
    cparams["options"] = f"{options} -c lock_timeout={LOCK_TIMEOUT_MS}".strip()
