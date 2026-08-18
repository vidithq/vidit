"""Chase an X status: one syndication read of the post a link names.

The technology X serves footage on is a status, so this chaser answers for a
status id and for any URL naming one, and declines everything else. What comes
back is the post itself (author, text, date, media), which the resolution
stores as the thread's quoted post.
"""

from __future__ import annotations

import httpx

from ..errors import TweetFetchFailed, TweetNotAccessible
from ..records import ChasedPost
from ..syndication import extract_media, fetch_syndication
from ..urls import canonical_tweet_url, x_status_id


def chase(target: str, *, client: httpx.Client | None = None) -> ChasedPost | None:
    """The X status ``target`` names, read through syndication.

    ``target`` is a bare status id (what an export holds for a quote) or a URL
    naming a status on an X host. ``None`` when ``target`` names no X status,
    when X will not serve it, or when the payload carries no author, since an
    authorless post cannot be attributed and so is not footage anyone declared.
    """
    # ``isascii`` with ``isdigit``: the latter is True for every Unicode decimal
    # digit, so an Arabic-Indic or fullwidth string would pass as a status id and
    # go into the syndication URL as something X cannot read.
    status_id = target if target.isascii() and target.isdigit() else x_status_id(target)
    if status_id is None:
        return None
    try:
        body = fetch_syndication(status_id, client=client)
    except (TweetFetchFailed, TweetNotAccessible):
        return None
    user = body.get("user")
    handle = user.get("screen_name") if isinstance(user, dict) else None
    if not isinstance(handle, str) or not handle:
        return None
    text = body.get("text")
    created_at = body.get("created_at")
    return ChasedPost(
        url=canonical_tweet_url(status_id, handle),
        posted_at=created_at if isinstance(created_at, str) and created_at else None,
        media=list(extract_media(body, origin="quote")),
        author=handle,
        text=text if isinstance(text, str) else "",
        status_id=status_id,
    )
