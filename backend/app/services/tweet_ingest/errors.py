"""Failures surfaced by the tweet-ingest package.

Shared by every path: ``syndication`` raises them on fetch / URL problems,
``parse`` re-raises ``TweetFetchFailed`` on a malformed response, and the
greenfield ``archive`` / ``detect`` paths will raise the same set — a leaf
module so any of them can import without a cycle.
"""

from __future__ import annotations


class TweetImportError(RuntimeError):
    """Base class for every parse / fetch failure surfaced by this package."""


class InvalidTweetUrl(TweetImportError):
    """The URL the caller provided isn't a tweet URL we can fetch.

    Examples: ``https://example.com``, an X profile page, an X search URL,
    a malformed string. Routes turn this into a ``400``.
    """


class TweetNotAccessible(TweetImportError):
    """The syndication endpoint returned 404 / the tweet is gone / protected.

    Routes turn this into a ``404``.
    """


class TweetFetchFailed(TweetImportError):
    """The syndication endpoint was unreachable / 5xx / schema drift.

    Routes turn this into a ``502``: the frontend's "fill the form
    manually" banner doesn't distinguish transport blips from schema drift
    (operationally identical — "retry later or do it by hand").
    """
