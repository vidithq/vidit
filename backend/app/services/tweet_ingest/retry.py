"""The retry policy every outgoing fetch of the ingestion shares.

Callers: :func:`syndication.fetch_syndication`, the Telegram embed read in
``chase/telegram.py``, and ``archive.fetch_cdn_media``. All three hit
throttled public endpoints, and one attempt would turn a short outage into a
detection with no footage.

:data:`ATTEMPTS` attempts, pausing :data:`BACKOFF_S`, never sleeping more than
:data:`RETRY_BUDGET_S` in total (the paste request runs this inline). One
schedule for every entry, so the bot and the paste behave alike under throttling.

Only transient failures are retried (:func:`is_transient`); a gone or
restricted post or an unparseable body fails on the first attempt.

:func:`retrying` blocks on purpose: every sync caller already runs off the
event loop. :func:`retrying_async` serves the async CDN media fetch.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from .errors import TweetImportError, TweetUpstreamBusy, TweetUpstreamUnreachable

logger = logging.getLogger(__name__)

# The second attempt covers a blip, the third a clearing throttle; a fourth
# would only hold the request open.
ATTEMPTS = 3

# Pause before each retry (``ATTEMPTS - 1`` entries).
BACKOFF_S = (1.0, 3.0)

# Ceiling on total sleep per fetch, whatever ``Retry-After`` asks. A pause that
# would cross it is not taken.
RETRY_BUDGET_S = 6.0


def is_transient(exc: BaseException) -> bool:
    """Whether a second attempt could clear ``exc``: busy or unreachable upstream."""
    return isinstance(exc, TweetUpstreamBusy | TweetUpstreamUnreachable)


def parse_retry_after(value: str | None) -> float | None:
    """Seconds from a ``Retry-After`` header, else ``None``.

    The HTTP-date form is ignored: it would trust a remote clock.
    """
    if value is None:
        return None
    try:
        seconds = float(value.strip())
    except ValueError:
        return None
    return seconds if seconds >= 0 else None


def _pause(exc: BaseException, *, retry: int, slept: float) -> float | None:
    """Seconds to wait before retry number ``retry``, or ``None`` to give up
    (not transient, no retry left, or :data:`RETRY_BUDGET_S` would be exceeded)."""
    if not is_transient(exc) or retry >= len(BACKOFF_S):
        return None
    asked = exc.retry_after if isinstance(exc, TweetUpstreamBusy) else None
    # The upstream's longer delay wins; coming back sooner earns the next 429.
    wait = max(BACKOFF_S[retry], asked or 0.0)
    return None if slept + wait > RETRY_BUDGET_S else wait


def _exhausted(exc: BaseException, what: str) -> None:
    """Log the last attempt's failure, once per fetch."""
    if is_transient(exc):
        logger.warning("Fetch of %s failed after %d attempts: %s", what, ATTEMPTS, exc)


def retrying[T](call: Callable[[], T], *, what: str) -> T:
    """``call()``, retried on transient failures.

    Other failures come straight back, and the last attempt's exception is what
    the caller sees. ``what`` names the target in the exhaustion log line.
    """
    slept = 0.0
    for retry in range(ATTEMPTS - 1):
        try:
            return call()
        except TweetImportError as exc:
            wait = _pause(exc, retry=retry, slept=slept)
            if wait is None:
                raise
            slept += wait
            _sleep(wait)
    try:
        return call()
    except TweetImportError as exc:
        _exhausted(exc, what)
        raise


async def retrying_async[T](call: Callable[[], Awaitable[T]], *, what: str) -> T:
    """:func:`retrying` for an awaitable ``call``, pausing off the event loop."""
    slept = 0.0
    for retry in range(ATTEMPTS - 1):
        try:
            return await call()
        except TweetImportError as exc:
            wait = _pause(exc, retry=retry, slept=slept)
            if wait is None:
                raise
            slept += wait
            await _sleep_async(wait)
    try:
        return await call()
    except TweetImportError as exc:
        _exhausted(exc, what)
        raise


def _sleep(seconds: float) -> None:
    """The blocking pause, patched by tests to record the schedule."""
    time.sleep(seconds)


async def _sleep_async(seconds: float) -> None:
    """Async twin of :func:`_sleep`."""
    await asyncio.sleep(seconds)
