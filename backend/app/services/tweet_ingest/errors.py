"""Failures surfaced by the tweet-ingest package (leaf module)."""

from __future__ import annotations


class TweetImportError(RuntimeError):
    """Base class for every parse / fetch failure surfaced by this package."""


class InvalidTweetUrl(TweetImportError):
    """The URL is not a fetchable tweet URL (a profile, a search, a malformed
    string). Routes answer ``400``."""


class TweetNotAccessible(TweetImportError):
    """The tweet is not readable without a login: the syndication 404 (gone,
    protected), or the ``TweetTombstone`` body X sends with a 200 (age-restricted,
    withheld). Routes answer ``404`` with the message as ``detail``, so it is
    analyst-facing prose.
    """


class TweetFetchFailed(TweetImportError):
    """The syndication endpoint was unreachable, answered 5xx, or drifted in schema.
    Routes answer ``502``."""


class TweetUpstreamBusy(TweetFetchFailed):
    """X declined to serve the request for now: a 429, or X's own 5xx.

    The unauthenticated syndication budget is shared, so throttling is expected.
    Routes answer ``503`` (apart from the ``502`` of payload drift), so the two
    reach Sentry as separate issues.

    ``retry_after`` is the ``Retry-After`` delay in seconds, ``None`` when absent
    or a date. Only :mod:`tweet_ingest.retry` reads it.

    A subclass of ``TweetFetchFailed`` so fail-soft callers
    (``acquire._self_reply_parent``, ``chase/``) keep degrading.
    """

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class TweetUpstreamUnreachable(TweetFetchFailed):
    """No answer at all: a timeout or transport error.

    Separate from :class:`TweetUpstreamBusy` so the retry policy can name the
    two retryable failures. A ``TweetFetchFailed`` subclass (``502``).
    """
