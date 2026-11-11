"""The page reads and the answer the embed chasers share."""

from __future__ import annotations

import httpx

from ..records import ChasedPost, ChaseResult, ParsedMedia
from ..retry import retrying
from ..syndication import USER_AGENT, http_get


def get_page(url: str, *, client: httpx.Client | None) -> httpx.Response:
    """One GET of ``url`` under the retry schedule, any status but a transient one.

    Redirects are not followed: each chaser's URL gate vets only the first hop,
    so a 3xx comes back for the caller to read or refuse.
    """
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html"}
    return retrying(lambda: http_get(url, headers=headers, client=client), what=url)


def read_page(url: str, *, client: httpx.Client | None) -> str | None:
    """The page at ``url``, ``None`` unless it answered 200 (a 3xx reads as unavailable)."""
    resp = get_page(url, client=client)
    return resp.text if resp.status_code == 200 else None


def embed_result(target: str, posted_at: str | None, media: list[ParsedMedia]) -> ChaseResult:
    """``chased`` with at least a date or media, else ``not_accessible``.

    ``url`` is the target as written: the resolution matches it back to the declared link.
    """
    if posted_at is None and not media:
        return ChaseResult(outcome="not_accessible")
    return ChaseResult(
        outcome="chased", post=ChasedPost(url=target, posted_at=posted_at, media=media)
    )
