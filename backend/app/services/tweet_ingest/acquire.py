"""Acquire a tweet, and the post it replies to, via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``. ``acquire_thread`` is the
one acquisition the live entries share (the bot's tagged mention and the pasted
tweet): it reads the post named by a tweet id plus, when that post replies to
one of its own author's, that parent. Exactly one hop, and only within one
author, so the result is a thread ``resolve_thread`` reads as the analyst's own
work. The archive keeps its own reader: an export carries every reply edge
inline, so it stitches whole self-threads without a fetch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .errors import TweetFetchFailed, TweetImportError, TweetNotAccessible
from .records import QuotedTweet, SourceLink, TweetRecord
from .syndication import (
    _extract_media,
    extract_media_shortlinks,
    extract_source_links,
    fetch_syndication,
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


def _permalink(tweet_id: str, handle: str) -> str:
    """The canonical permalink for ``tweet_id`` posted by ``handle``.

    ``handle`` is the ``i`` sentinel when the caller has none (a URL in the
    ``/i/web/status/<id>`` form). That form is kept as X serves it, since
    ``x.com/i/status/<id>`` 404s.
    """
    if handle == "i":
        return f"https://x.com/i/web/status/{tweet_id}"
    return f"https://x.com/{handle}/status/{tweet_id}"


def record_by_id(tweet_id: str, *, handle: str, client: httpx.Client | None = None) -> TweetRecord:
    """Fetch the post ``tweet_id`` via syndication and map it to a ``TweetRecord``.

    ``handle`` is the author handle the caller already holds (from a mention
    payload, a pasted URL, or the post a reply hangs under). It anchors the
    permalink, which is the ``(detected_from_url, coordinate)`` idempotency key,
    so callers that know the handle in more than one case pass it case-folded.
    The record's own ``handle`` field prefers the response's screen name, the
    authoritative value and the only one a ``/i/web/status/<id>`` URL yields.

    The optional ``client`` is for tests (a ``MockTransport``). Raises the same
    ``TweetImportError`` subclasses as ``fetch_syndication``.
    """
    body = fetch_syndication(tweet_id, client=client)

    author = handle
    user = body.get("user")
    if isinstance(user, dict):
        screen_name = user.get("screen_name")
        if isinstance(screen_name, str) and screen_name:
            author = screen_name

    text = body.get("text")
    created_at = body.get("created_at")
    in_reply_to_status = body.get("in_reply_to_status_id_str")
    in_reply_to_user = body.get("in_reply_to_user_id_str")
    return TweetRecord(
        tweet_id=tweet_id,
        handle=author,
        text=text if isinstance(text, str) else "",
        created_at=created_at if isinstance(created_at, str) else "",
        permalink=_permalink(tweet_id, handle),
        media=list(_extract_media(body, origin="op")),
        media_shortlinks=extract_media_shortlinks(body),
        in_reply_to_status_id=(in_reply_to_status if isinstance(in_reply_to_status, str) else None),
        in_reply_to_user_id=in_reply_to_user if isinstance(in_reply_to_user, str) else None,
        quoted=_quoted_record(body),
        external_sources=[
            SourceLink(url=u, host=h, shortlink=t) for u, h, t in extract_source_links(body)
        ],
    )


@dataclass(frozen=True)
class AcquiredThread:
    """What one hop of acquisition yields.

    ``records`` is the thread ``resolve_thread`` reads, parent first then the
    post, so the head is the earliest post and carries the provenance.
    ``post`` is the record for the id the caller named, which the bot needs to
    tell the tagged reply from the parent it relays.
    """

    records: list[TweetRecord]
    post: TweetRecord
    parent: TweetRecord | None


def _self_reply_parent(
    post: TweetRecord, *, client: httpx.Client | None = None
) -> TweetRecord | None:
    """The post ``post`` replies to, when its author is ``post``'s own author.

    One hop, one syndication fetch. The same-author guard runs on the fetched
    parent's handle, the authoritative value, which is what stops an analyst
    from claiming a geolocation posted under someone else's footage. Fail-soft:
    a fetch failure reads as "no parent", so the post resolves alone.
    """
    if post.in_reply_to_status_id is None:
        return None
    try:
        # Case-folded handle: the parent's permalink anchors the idempotency
        # key that the parent's own import would land on, so a case drift
        # between the feed that named the post and the syndication screen name
        # cannot split one geolocation across two keys.
        parent = record_by_id(post.in_reply_to_status_id, handle=post.handle.lower(), client=client)
    except TweetImportError:
        return None
    if parent.handle.lower() != post.handle.lower():
        return None
    return parent


def acquire_thread(
    tweet_id: str, *, handle: str, client: httpx.Client | None = None
) -> AcquiredThread:
    """The post ``tweet_id``, plus the same author's post it replies to.

    The one acquisition the bot and the pasted-tweet import share, so a
    coordinate in a post and a source link in its author's own reply reach the
    resolution together whichever entry read them. Exactly one hop: a parent's
    own parent is never read, and a parent by another author is never joined to
    the thread, whatever it holds.

    ``handle`` is the author handle the caller already holds; see
    :func:`record_by_id`. The post itself raises what ``fetch_syndication``
    raises; only the parent leg is fail-soft.
    """
    post = record_by_id(tweet_id, handle=handle, client=client)
    parent = _self_reply_parent(post, client=client)
    return AcquiredThread(
        records=[parent, post] if parent is not None else [post], post=post, parent=parent
    )
