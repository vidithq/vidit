"""Chase an X status: one syndication read of the post a link names.

Answers for a status id or a URL naming one; the post (author, text, date,
media) is stored by the resolution as the thread's quoted post.
"""

from __future__ import annotations

import httpx

from ..errors import TweetFetchFailed, TweetNotAccessible
from ..records import ChasedPost, ChaseResult
from ..retry import is_transient
from ..syndication import extract_media, fetch_syndication
from ..urls import canonical_tweet_url, x_status_id


def chase(target: str, *, client: httpx.Client | None = None) -> ChaseResult:
    """The X status ``target`` (a bare id or a status URL) read through syndication.

    ``no_target`` when it names no X status; ``transient_failure`` when throttled
    or unanswered after the retry schedule (``fetch_syndication``);
    ``not_accessible`` otherwise, including a payload with no author (an
    authorless post cannot be attributed).
    """
    # ``isdigit`` alone accepts any Unicode decimal digit, which X cannot read.
    status_id = target if target.isascii() and target.isdigit() else x_status_id(target)
    if status_id is None:
        return ChaseResult(outcome="no_target")
    try:
        body = fetch_syndication(status_id, client=client)
    except (TweetFetchFailed, TweetNotAccessible) as exc:
        return ChaseResult(outcome="transient_failure" if is_transient(exc) else "not_accessible")
    user = body.get("user")
    handle = user.get("screen_name") if isinstance(user, dict) else None
    if not isinstance(handle, str) or not handle:
        return ChaseResult(outcome="not_accessible")
    text = body.get("text")
    created_at = body.get("created_at")
    return ChaseResult(
        outcome="chased",
        post=ChasedPost(
            url=canonical_tweet_url(status_id, handle),
            posted_at=created_at if isinstance(created_at, str) and created_at else None,
            media=list(extract_media(body, origin="quote")),
            author=handle,
            text=text if isinstance(text, str) else "",
            status_id=status_id,
        ),
    )
