"""Acquire a single tweet via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``: one fetch, one record, no
reply edges (syndication can't expose a self-thread in one call, so ``stitch``
is the identity here). Backs the no-persist detection preview on
``import-from-tweet``; the bot (Phase B) is the other consumer.
"""

from __future__ import annotations

import httpx

from .records import TweetRecord
from .syndication import _extract_media, fetch_syndication, normalise_tweet_url


def record_from_syndication(url: str, *, client: httpx.Client | None = None) -> TweetRecord:
    """Fetch ``url`` via syndication and map it to a single ``TweetRecord``.

    Prefers the response's screen name over the URL's (``/i/web/status/<id>``
    carries none). The optional ``client`` is for tests (a ``MockTransport``).
    Raises the same ``TweetImportError`` subclasses as ``fetch_syndication``.
    """
    normalised = normalise_tweet_url(url)
    body = fetch_syndication(normalised.tweet_id, client=client)

    handle = normalised.handle
    user = body.get("user")
    if isinstance(user, dict):
        screen_name = user.get("screen_name")
        if isinstance(screen_name, str) and screen_name:
            handle = screen_name

    text = body.get("text")
    created_at = body.get("created_at")
    return TweetRecord(
        tweet_id=normalised.tweet_id,
        handle=handle,
        text=text if isinstance(text, str) else "",
        created_at=created_at if isinstance(created_at, str) else "",
        permalink=normalised.canonical,
        media=list(_extract_media(body, origin="op")),
    )
