"""Acquire a single tweet via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``: one fetch, one record, no
reply edges (syndication can't expose a self-thread in one call, so ``stitch``
is the identity here). Backs the no-persist detection preview on
``import-from-tweet``; the bot is the other consumer.
"""

from __future__ import annotations

from typing import Any

import httpx

from .records import QuotedTweet, SourceLink, TweetRecord
from .syndication import (
    _extract_media,
    extract_source_links,
    fetch_syndication,
    normalise_tweet_url,
)


def _quoted_record(body: dict[str, Any]) -> QuotedTweet | None:
    """The inline quoted tweet as a full sub-record (id, handle, text, date,
    media). The syndication body embeds it, so this needs no extra fetch."""
    qt = body.get("quoted_tweet")
    if not isinstance(qt, dict):
        return None
    tweet_id = qt.get("id_str")
    user = qt.get("user")
    if not isinstance(tweet_id, str) or not isinstance(user, dict):
        return None
    handle = user.get("screen_name")
    if not isinstance(handle, str) or not handle:
        return None
    raw_text = qt.get("text")
    raw_created = qt.get("created_at")
    return QuotedTweet(
        tweet_id=tweet_id,
        handle=handle,
        text=raw_text if isinstance(raw_text, str) else "",
        created_at=raw_created if isinstance(raw_created, str) else "",
        media=list(_extract_media(qt, origin="quote")),
    )


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
        quoted=_quoted_record(body),
        external_sources=[SourceLink(url=u, host=h) for u, h in extract_source_links(body)],
    )
