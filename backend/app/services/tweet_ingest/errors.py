"""Failures surfaced by the tweet-ingest package (leaf module)."""

from __future__ import annotations


class TweetImportError(RuntimeError):
    pass


class InvalidTweetUrl(TweetImportError):
    """The URL names no post (a profile, a search, a malformed string)."""


class TweetNotAccessible(TweetImportError):
    """Not readable without a login: the syndication 404 (gone, protected), or the
    ``TweetTombstone`` body X sends with a 200 (age-restricted, withheld)."""


class TweetFetchFailed(TweetImportError):
    """The upstream was unreachable, answered an unexpected status, or drifted in schema."""


class TweetUpstreamBusy(TweetFetchFailed):
    """The upstream declined to serve for now: a 429 or a 5xx.

    The unauthenticated syndication budget is shared, so throttling is expected. A subclass
    of ``TweetFetchFailed`` so fail-soft callers keep degrading. ``retry_after`` is the
    ``Retry-After`` delay in seconds, ``None`` when absent or a date.
    """

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class TweetUpstreamUnreachable(TweetFetchFailed):
    """No answer at all: a timeout or transport error."""


class MediaTooLarge(TweetImportError):
    """A CDN media body ran past ``archive.MEDIA_FETCH_MAX_BYTES``: dropped, never buffered."""
