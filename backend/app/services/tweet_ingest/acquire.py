"""Acquire a single tweet via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``: one fetch, one record.
A reply's parent *pointer* (``in_reply_to_status_id_str``) is mapped when the
payload carries it, but the chain itself is not — one call returns one tweet,
so ``stitch`` over a single record is the identity. The preview uses it that
way; the bot walks the pointer one ``fetch_syndication`` at a time to rebuild
a self-thread (see ``services/bot``).
"""

from __future__ import annotations

from typing import Any

import httpx

from .errors import TweetFetchFailed, TweetNotAccessible
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


def quoted_from_syndication(
    quoted_id: str, *, client: httpx.Client | None = None
) -> QuotedTweet | None:
    """Chase a source tweet by id via syndication into a ``QuotedTweet``.

    The one chase both linked-source paths run: the archive backfill (a
    ``Source: <x status>`` link with ``chase`` on) and the bot's strict
    mention format (the ``S:`` link). Fail-soft: a fetch error degrades to
    "no source tweet" and never fails the caller's pass.
    """
    try:
        body = fetch_syndication(quoted_id, client=client)
    except (TweetFetchFailed, TweetNotAccessible):
        return None
    user = body.get("user")
    handle = user.get("screen_name") if isinstance(user, dict) else None
    if not isinstance(handle, str) or not handle:
        return None
    text = body.get("text")
    created_at = body.get("created_at")
    return QuotedTweet(
        tweet_id=quoted_id,
        handle=handle,
        text=text if isinstance(text, str) else "",
        created_at=created_at if isinstance(created_at, str) else "",
        media=list(_extract_media(body, origin="quote")),
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
    in_reply_to_status = body.get("in_reply_to_status_id_str")
    in_reply_to_user = body.get("in_reply_to_user_id_str")
    return TweetRecord(
        tweet_id=normalised.tweet_id,
        handle=handle,
        text=text if isinstance(text, str) else "",
        created_at=created_at if isinstance(created_at, str) else "",
        permalink=normalised.canonical,
        media=list(_extract_media(body, origin="op")),
        in_reply_to_status_id=(in_reply_to_status if isinstance(in_reply_to_status, str) else None),
        in_reply_to_user_id=in_reply_to_user if isinstance(in_reply_to_user, str) else None,
        quoted=_quoted_record(body),
        external_sources=[SourceLink(url=u, host=h) for u, h in extract_source_links(body)],
    )
