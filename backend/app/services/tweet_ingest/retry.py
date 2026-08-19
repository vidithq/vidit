"""The retry policy every outgoing fetch of the ingestion shares.

An import spends its fetches on unauthenticated public endpoints: X's
syndication backend, Telegram's public embed, the CDNs the media sit on. All
three throttle and all three wobble, and a single attempt turns a two-second
outage into a detection with no footage, or into a refusal the analyst reads as
"that post is gone".

One schedule, one home, three callers (:func:`syndication.fetch_syndication`,
the Telegram embed read in ``chase/telegram.py``, and ``archive.fetch_cdn_media``):
:data:`ATTEMPTS` attempts, pausing :data:`BACKOFF_S` between them, and never
sleeping more than :data:`RETRY_BUDGET_S` in total, so the paste request, which
runs one of these inline, keeps a bounded worst case. The pauses are the same on
every entry: the request path would need a second schedule to shorten them, and
two schedules is how the bot and the paste start behaving differently under the
same throttling.

Only the transient half is retried (:func:`is_transient`): a throttled or
unreachable upstream. A post that is gone, restricted, or a body that will not
parse, comes back on the first attempt exactly as it does today, since no number
of retries changes any of them.

Sleeping is blocking on purpose in :func:`retrying`. Every sync caller already
runs off the event loop (the paste route is a threadpool ``def``, the bot's
acquisition runs under ``asyncio.to_thread``, the archive worker is its own
process); :func:`retrying_async` is the twin for the one caller that is already
async, the CDN media fetch.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from .errors import TweetImportError, TweetUpstreamBusy, TweetUpstreamUnreachable

logger = logging.getLogger(__name__)

# Three attempts: the second covers the one-off blip, the third covers a
# throttle that is clearing. Past that the analyst is better served by being
# told, since they can act (import again later, add the footage at review)
# while a fourth attempt only holds their request open.
ATTEMPTS = 3

# The pause before each retry, one entry per retry, so it is
# ``ATTEMPTS - 1`` long.
BACKOFF_S = (1.0, 3.0)

# The ceiling on the total time one fetch may spend asleep, whatever the
# schedule and whatever an upstream's ``Retry-After`` asks for. A pause that
# would cross it is not taken: the fetch fails now rather than holding a paste
# request open for a delay the analyst can spend better.
RETRY_BUDGET_S = 6.0


def is_transient(exc: BaseException) -> bool:
    """Whether ``exc`` is a failure a second attempt could clear.

    The two upstream conditions that pass with time: a refusal to serve right
    now (:class:`TweetUpstreamBusy`, a 429 or the upstream's own 5xx) and an
    answer that never arrived (:class:`TweetUpstreamUnreachable`, a timeout or a
    transport error).
    """
    return isinstance(exc, TweetUpstreamBusy | TweetUpstreamUnreachable)


def parse_retry_after(value: str | None) -> float | None:
    """The seconds an upstream's ``Retry-After`` header asks for, else ``None``.

    Only the delta-seconds form is read. The HTTP-date form is the other legal
    spelling and is ignored: reading it means trusting a remote clock against
    ours to decide how long to hold a request, and the schedule below is a fine
    answer without it.
    """
    if value is None:
        return None
    try:
        seconds = float(value.strip())
    except ValueError:
        return None
    return seconds if seconds >= 0 else None


def _pause(exc: BaseException, *, retry: int, slept: float) -> float | None:
    """How long to wait before retry number ``retry``, or ``None`` to give up.

    ``None`` for a failure a retry cannot fix, for a retry the schedule does not
    have, and for a pause that would spend more than :data:`RETRY_BUDGET_S` in
    total, which is how an upstream asking for a long ``Retry-After`` ends the
    attempts instead of stretching them.
    """
    if not is_transient(exc) or retry >= len(BACKOFF_S):
        return None
    asked = exc.retry_after if isinstance(exc, TweetUpstreamBusy) else None
    # The upstream's own delay wins when it is longer than ours: it named a
    # figure, and coming back sooner is what earns the next 429.
    wait = max(BACKOFF_S[retry], asked or 0.0)
    return None if slept + wait > RETRY_BUDGET_S else wait


def _exhausted(exc: BaseException, what: str) -> None:
    """Log the failure the last attempt came back with, once per fetch."""
    if is_transient(exc):
        logger.warning("Fetch of %s failed after %d attempts: %s", what, ATTEMPTS, exc)


def retrying[T](call: Callable[[], T], *, what: str) -> T:
    """``call()``, retried on the transient failures it raises.

    ``call`` raises the package's own failures (:mod:`tweet_ingest.errors`); the
    transient ones are retried per the schedule above and every other one comes
    straight back. What the last attempt raises is what the caller sees, so a
    caller's own handling of a busy or unreachable upstream is unchanged: it
    just runs later. ``what`` names the target in the one log line an exhausted
    fetch writes.
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
    """The blocking pause, behind a name of this module's own so the test suite
    can record the schedule instead of living through it."""
    time.sleep(seconds)


async def _sleep_async(seconds: float) -> None:
    """:func:`_sleep`'s twin for :func:`retrying_async`."""
    await asyncio.sleep(seconds)
