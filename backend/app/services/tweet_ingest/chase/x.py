"""Chase an X status: one syndication read of the post a link names.

The technology X serves footage on is a status, so this chaser answers for a
status id and for any URL naming one, and declines everything else. What comes
back is the post itself (author, text, date, media), which the resolution
stores as the thread's quoted post.
"""

from __future__ import annotations

import httpx

from ..errors import TweetFetchFailed, TweetNotAccessible
from ..records import ChasedPost, ChaseResult
from ..retry import is_transient
from ..syndication import extract_media, fetch_syndication
from ..urls import canonical_tweet_url, x_status_id


def chase(target: str, *, client: httpx.Client | None = None) -> ChaseResult:
    """The X status ``target`` names, read through syndication.

    ``target`` is a bare status id (what an export holds for a quote) or a URL
    naming a status on an X host. ``no_target`` when ``target`` names no X
    status, which is how the dispatcher moves on to the next chaser.
    ``transient_failure`` when X throttled us or never answered, the retry
    schedule already spent (``fetch_syndication``). ``not_accessible`` for
    everything else X answers with and nothing can be taken from: a post it
    will not serve, and a payload carrying no author, since an authorless post
    cannot be attributed and so is not footage anyone declared.
    """
    # ``isascii`` with ``isdigit``: the latter is True for every Unicode decimal
    # digit, so an Arabic-Indic or fullwidth string would pass as a status id and
    # go into the syndication URL as something X cannot read.
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
