"""Error tracking and log output, shared by the API and the scheduler scripts."""

import logging
import sys
from contextvars import ContextVar
from typing import TextIO

import sentry_sdk

from app.config import settings

# The id of the HTTP request being served, set by ``RequestIdMiddleware``.
request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"
# Marks the handlers ``configure_logging`` installs, so a second call replaces them.
_OWN_HANDLER = "vidit_handler"


class RequestIdFilter(logging.Filter):
    """Stamp each record with the id of the request that emitted it, ``-`` outside one."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get() or "-"
        return True


def _below_warning(record: logging.LogRecord) -> bool:
    return record.levelno < logging.WARNING


def _handler(stream: TextIO, level: int) -> logging.Handler:
    handler = logging.StreamHandler(stream)
    handler.setLevel(level)
    handler.addFilter(RequestIdFilter())
    setattr(handler, _OWN_HANDLER, True)
    return handler


def configure_logging() -> None:
    """Print each record once as a ``LOG_FORMAT`` line: below ``WARNING`` on
    standard output, ``WARNING`` and above on standard error.

    Railway files a stderr line as an error, so a traceback shows as one.
    Uvicorn sets up its own loggers before it imports the app; this hands each
    one that has handlers to the root handlers, so the access log and the
    server errors share the format. A logger uvicorn muted
    (``--no-access-log``) stays muted, and a root logger a ``--log-config``
    already gave handlers stays as it is. ``LOG_LEVEL`` sets the level of the
    ``app`` loggers; libraries print from ``WARNING``, and uvicorn's loggers
    keep the level uvicorn gave them.
    """
    root = logging.getLogger()
    if any(not getattr(handler, _OWN_HANDLER, False) for handler in root.handlers):
        return
    stdout = _handler(sys.stdout, logging.NOTSET)
    stdout.addFilter(_below_warning)
    stderr = _handler(sys.stderr, logging.WARNING)
    logging.basicConfig(format=LOG_FORMAT, handlers=[stdout, stderr], force=True)
    logging.getLogger("app").setLevel(settings.log_level)
    for name in ("uvicorn", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        if uvicorn_logger.handlers:
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
