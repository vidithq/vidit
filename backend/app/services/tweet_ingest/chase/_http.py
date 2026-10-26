"""The one page GET the embed chasers share: redirects never followed, failures typed."""

from __future__ import annotations

import httpx

from ..errors import TweetUpstreamBusy, TweetUpstreamUnreachable
from ..retry import parse_retry_after

HTTP_TIMEOUT_S = 5.0
USER_AGENT = "vidit-tweet-import/1.0"


def get_page(url: str, *, client: httpx.Client | None) -> httpx.Response:
    """One GET of ``url``, any status but a transient one.

    Redirects are not followed: each chaser's URL gate vets only the first hop,
    so a 3xx comes back for the caller to read or refuse. A throttled upstream
    raises :class:`TweetUpstreamBusy` and an unanswered one
    :class:`TweetUpstreamUnreachable`, which the retry schedule retries.
    ``client`` is for tests (a ``MockTransport``).
    """
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html"}
    try:
        if client is None:
            with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=False) as own_client:
                resp = own_client.get(url, headers=headers)
        else:
            resp = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise TweetUpstreamUnreachable(f"transport error: {exc}") from exc
    if resp.status_code == 429 or resp.status_code >= 500:
        raise TweetUpstreamBusy(
            f"upstream returned {resp.status_code}",
            retry_after=parse_retry_after(resp.headers.get("Retry-After")),
        )
    return resp
