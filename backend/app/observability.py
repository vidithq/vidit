"""Error tracking and log output, shared by the API and the scheduler scripts."""

import logging
import sys
from contextvars import ContextVar

import sentry_sdk

from app.config import settings

# The id of the HTTP request being served, set by ``RequestIdMiddleware``.
request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"


class RequestIdFilter(logging.Filter):
    """Stamp each record with the id of the request that emitted it, ``-`` outside one."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get() or "-"
        return True


def configure_logging() -> None:
    """Print each record once on standard output, headed by a ``LOG_FORMAT`` line.

    Uvicorn sets up its own loggers before it imports the app; this hands them
    to the root handler, so the access log and the server errors share the
    format. ``LOG_LEVEL`` sets the level of the ``app`` loggers; libraries print
    from ``WARNING``, and uvicorn's loggers keep the level uvicorn gave them.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RequestIdFilter())
    logging.basicConfig(format=LOG_FORMAT, handlers=[handler], force=True)
    logging.getLogger("app").setLevel(settings.log_level)
    for name in ("uvicorn", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True


def init_sentry() -> None:
    """Start Sentry when ``SENTRY_DSN`` is set; do nothing otherwise.

    Events leave out frame local variables and request bodies. Either can hold
    a password or an API credential, and the SDK's denylist matches exact key
    names only (``password``, not ``new_password``).
    """
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
    )
