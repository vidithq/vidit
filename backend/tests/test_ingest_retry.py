"""The one retry schedule every ingest fetch shares, and what it is spent on.

Two halves: the policy itself (how many attempts, which failures earn one, what
an upstream's ``Retry-After`` moves) and the syndication read that runs it over
a mock transport. The other two callers are tested where they live, the CDN
media stream in ``test_archive`` and the Telegram embed in
``test_chase_telegram``. Nothing leaves the box, and nothing sleeps: the
``retry_sleeps`` fixture records the pauses the schedule asked for.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.tweet_ingest import retry, syndication
from app.services.tweet_ingest.errors import (
    TweetFetchFailed,
    TweetNotAccessible,
    TweetUpstreamBusy,
    TweetUpstreamUnreachable,
)

_TWEET_ID = "1657834636792287232"


@pytest.fixture(autouse=True)
def _clear_tweet_cache():
    syndication._cache_clear()
    yield
    syndication._cache_clear()


# ── The policy ────────────────────────────────────────────────────────────


def test_a_transient_failure_is_attempted_the_whole_schedule(retry_sleeps):
    """Three attempts, pausing the documented backoff between them, and the last
    failure is what the caller sees: a retry changes when a fetch answers, never
    what it answers."""
    attempts: list[int] = []

    def call() -> str:
        attempts.append(1)
        raise TweetUpstreamBusy("upstream returned 429")

    with pytest.raises(TweetUpstreamBusy):
        retry.retrying(call, what="a tweet")
    assert len(attempts) == retry.ATTEMPTS
    assert retry_sleeps == list(retry.BACKOFF_S)


def test_a_transient_failure_that_clears_answers_on_the_retry(retry_sleeps):
    answers = [TweetUpstreamUnreachable("timeout"), None]

    def call() -> str:
        answer = answers.pop(0)
        if answer is not None:
            raise answer
        return "body"

    assert retry.retrying(call, what="a tweet") == "body"
    assert retry_sleeps == [retry.BACKOFF_S[0]]


@pytest.mark.parametrize(
    "failure",
    [TweetNotAccessible("gone"), TweetFetchFailed("upstream returned __typename 'X'")],
)
def test_a_failure_a_retry_cannot_fix_is_raised_at_once(failure, retry_sleeps):
    """A deleted post and a payload that drifted come back on the first attempt.
    Retrying either one spends a request and the analyst's wait on an answer that
    cannot change, and on the paste it holds the request open for nothing."""
    attempts: list[int] = []

    def call() -> str:
        attempts.append(1)
        raise failure

    with pytest.raises(type(failure)):
        retry.retrying(call, what="a tweet")
    assert attempts == [1]
    assert retry_sleeps == []


def test_a_short_retry_after_replaces_the_pause_it_is_longer_than(retry_sleeps):
    """The upstream named a delay, so coming back sooner than it asked is what
    earns the next refusal. Only when it asks for longer than the schedule: a
    header asking for less does not shorten the backoff."""

    def call() -> str:
        raise TweetUpstreamBusy("upstream returned 429", retry_after=2.0)

    with pytest.raises(TweetUpstreamBusy):
        retry.retrying(call, what="a tweet")
    assert retry_sleeps == [2.0, retry.BACKOFF_S[1]]


def test_a_long_retry_after_ends_the_attempts_instead_of_stretching_them(retry_sleeps):
    """A fetch never sleeps past ``RETRY_BUDGET_S`` in total, so an upstream
    asking to be left alone for a minute is answered now: the paste runs one of
    these inline, and the analyst can act on the warning it lands with."""
    attempts: list[int] = []

    def call() -> str:
        attempts.append(1)
        raise TweetUpstreamBusy("upstream returned 429", retry_after=retry.RETRY_BUDGET_S + 1)

    with pytest.raises(TweetUpstreamBusy):
        retry.retrying(call, what="a tweet")
    assert attempts == [1]
    assert retry_sleeps == []


@pytest.mark.parametrize(
    "header,expected",
    [("3", 3.0), (" 12 ", 12.0), ("0", 0.0), ("Wed, 21 Oct 2026 07:28:00 GMT", None), ("-1", None)],
)
def test_retry_after_reads_the_delta_seconds_form_only(header, expected):
    """The HTTP-date spelling is ignored rather than parsed: honouring it means
    trusting a remote clock against ours to decide how long to hold a request."""
    assert retry.parse_retry_after(header) == expected
    assert retry.parse_retry_after(None) is None


# ── The syndication read that runs it ─────────────────────────────────────


def _client(responses: list[httpx.Response]) -> tuple[httpx.Client, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return responses[min(len(seen) - 1, len(responses) - 1)]

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


def test_a_throttled_syndication_read_retries_into_the_body(retry_sleeps):
    """X throttling one read is the common case the retry exists for: the second
    attempt serves the post, and the analyst's import never learns of the 429."""
    body = {"__typename": "Tweet", "id_str": _TWEET_ID, "text": "hello"}
    client, seen = _client([httpx.Response(429), httpx.Response(200, json=body)])
    with client:
        assert syndication.fetch_syndication(_TWEET_ID, client=client) == body
    assert len(seen) == 2
    assert retry_sleeps == [retry.BACKOFF_S[0]]


def test_a_syndication_read_honours_the_retry_after_x_sends(retry_sleeps):
    body = {"__typename": "Tweet", "id_str": _TWEET_ID}
    client, _seen = _client(
        [httpx.Response(429, headers={"Retry-After": "4"}), httpx.Response(200, json=body)]
    )
    with client:
        assert syndication.fetch_syndication(_TWEET_ID, client=client) == body
    assert retry_sleeps == [4.0]


def test_a_deleted_post_costs_one_syndication_read(retry_sleeps):
    client, seen = _client([httpx.Response(404)])
    with client, pytest.raises(TweetNotAccessible):
        syndication.fetch_syndication(_TWEET_ID, client=client)
    assert len(seen) == 1
    assert retry_sleeps == []


def test_only_a_served_body_is_cached(retry_sleeps):
    """The cache sits outside the retried round trip: the 429 leaves nothing
    behind, and the body the retry won is what the next read is served."""
    body = {"__typename": "Tweet", "id_str": _TWEET_ID}
    client, seen = _client([httpx.Response(429), httpx.Response(200, json=body)])
    with client:
        syndication.fetch_syndication(_TWEET_ID, client=client)
        assert syndication.fetch_syndication(_TWEET_ID, client=client) == body
    assert len(seen) == 2
