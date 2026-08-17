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
    """The tweet exists for X but not for an unauthenticated reader.

    Covers the syndication 404 (gone, protected, never existed) and the
    ``TweetTombstone`` body X answers with a 200 for a tweet readable only
    behind a login (age-restricted, withheld in a jurisdiction). Routes turn
    this into a ``404`` carrying the message as ``detail``, so the message is
    analyst-facing prose.
    """


class TweetFetchFailed(TweetImportError):
    """The syndication endpoint was unreachable / 5xx / schema drift.

    Routes turn this into a ``502``: the frontend's "fill the form
    manually" banner doesn't distinguish transport blips from schema drift
    (operationally identical — "retry later or do it by hand").
    """


class TweetUpstreamBusy(TweetFetchFailed):
    """X declined to serve the request for now: a 429, or X's own 5xx.

    The syndication budget is unauthenticated and shared by every analyst and
    the bot, so throttling is an expected outcome with its own operational
    story: wait, then retry. Routes turn this into a ``503`` naming the retry,
    apart from the ``502`` that means the payload drifted under us. Both stay
    5xx, so both keep reaching Sentry, as two issues instead of one bucket.

    A subclass of ``TweetFetchFailed`` on purpose: every fail-soft caller
    (``acquire.quoted_from_syndication``, ``acquire._self_reply_parent``) keeps
    degrading exactly as before, and only a caller that wants the distinction
    catches this class first.
    """
