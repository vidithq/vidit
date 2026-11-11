"""Chase an X status: one syndication read of the post a link names.

Answers for a status id or a URL naming one; the post (author, text, date,
media) is stored by the resolution as the thread's quoted post.
"""

from __future__ import annotations

import httpx

from ..records import ChaseResult
from ..syndication import fetch_syndication, source_post
from ..urls import x_status_id


def chase(target: str, *, client: httpx.Client | None = None) -> ChaseResult:
    """The X status ``target`` (a bare id or a status URL) read through syndication.

    ``no_target`` when it names no X status; ``not_accessible`` for a payload
    with no author (an authorless post cannot be attributed). Raises what
    ``fetch_syndication`` raises.
    """
    # ``isdigit`` alone accepts any Unicode decimal digit, which X cannot read.
    status_id = target if target.isascii() and target.isdigit() else x_status_id(target)
    if status_id is None:
        return ChaseResult(outcome="no_target")
    post = source_post(fetch_syndication(status_id, client=client), status_id)
    if post is None:
        return ChaseResult(outcome="not_accessible")
    return ChaseResult(outcome="chased", post=post)
