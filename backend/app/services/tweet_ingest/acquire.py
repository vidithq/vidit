"""Acquire a tweet, and the post it replies to, via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``. ``acquire_thread`` is the
one acquisition the live entries share (the bot's tagged mention and the pasted
tweet): it reads the post named by a tweet id plus, when that post replies to
one of its own author's, that parent. Exactly one hop, and only within one
author, so the result is a thread ``resolve_threads`` reads as the analyst's own
work. It then runs ``chase.chase_thread`` over that thread, the same one chase
step the archive backfill runs over each stitched self-thread, so the resolution
downstream is pure and neither knows which technology answered. The archive
keeps its own reader: an export carries every reply edge inline, so it stitches
whole self-threads without a fetch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .chase import chase_thread
from .errors import TweetImportError
from .records import QuotedTweet, SourceLink, TweetRecord
from .syndication import extract_media, extract_source_links, fetch_syndication
from .urls import normalise_tweet_url


def _quoted_status_id(body: dict[str, Any]) -> str | None:
    """The id of the post ``body`` quotes, or ``None`` when it quotes none."""
    qt = body.get("quoted_tweet")
    tweet_id = qt.get("id_str") if isinstance(qt, dict) else None
    return tweet_id if isinstance(tweet_id, str) and tweet_id else None


def _quoted_record(body: dict[str, Any]) -> QuotedTweet | None:
    """The inline quoted tweet as a full sub-record (id, handle, text, date,
    media). The syndication body embeds it, so this needs no extra fetch."""
    qt = body.get("quoted_tweet")
    tweet_id = _quoted_status_id(body)
    if not isinstance(qt, dict) or tweet_id is None:
        return None
    user = qt.get("user")
    if not isinstance(user, dict):
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
        media=list(extract_media(qt, origin="quote")),
    )


def record_by_id(tweet_id: str, *, handle: str, client: httpx.Client | None = None) -> TweetRecord:
    """Fetch the post ``tweet_id`` via syndication and map it to a ``TweetRecord``.

    ``handle`` is the author handle the caller already holds (from a mention
    payload, a pasted URL, or the post a reply hangs under), and it is the
    fallback: the record's own ``handle`` prefers the response's screen name,
    the authoritative value and the only one a ``/i/web/status/<id>`` URL
    yields.

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
    return TweetRecord(
        tweet_id=tweet_id,
        handle=author,
        text=text if isinstance(text, str) else "",
        created_at=created_at if isinstance(created_at, str) else "",
        media=list(extract_media(body, origin="op")),
        in_reply_to_status_id=(in_reply_to_status if isinstance(in_reply_to_status, str) else None),
        quoted=_quoted_record(body),
        quoted_status_id=_quoted_status_id(body),
        external_sources=[SourceLink(url=u, shortlink=t) for u, t in extract_source_links(body)],
    )


@dataclass(frozen=True)
class AcquiredThread:
    """What one hop of acquisition yields.

    ``records`` is the thread ``resolve_threads`` reads, parent first then the
    post, so the head is the earliest post and carries the provenance.
    ``post`` is the record for the id the caller named, which the paste reads
    to check the post's author against the caller's linked handle.
    """

    records: list[TweetRecord]
    post: TweetRecord


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
        parent = record_by_id(post.in_reply_to_status_id, handle=post.handle, client=client)
    except TweetImportError:
        return None
    if parent.handle.lower() != post.handle.lower():
        return None
    return parent


def acquire_from_post(post: TweetRecord, *, client: httpx.Client | None = None) -> AcquiredThread:
    """The rest of the one hop over a post already read: the same author's
    parent, then the chase.

    Split from :func:`acquire_thread` so a caller holding an ownership rule can
    settle it on ``post`` alone, before this spends anything further. Both legs
    are fail-soft: a parent that will not fetch reads as no parent, and a
    footage link that will not chase reads as no footage.
    """
    parent = _self_reply_parent(post, client=client)
    records = chase_thread([parent, post] if parent is not None else [post], client=client)
    return AcquiredThread(records=records, post=post)


def acquire_thread(
    tweet_id: str, *, handle: str, client: httpx.Client | None = None
) -> AcquiredThread:
    """The post ``tweet_id``, plus the same author's post it replies to, with the
    thread's sole source candidate chased.

    The one acquisition the bot and the pasted-tweet import share, so a
    coordinate in a post and a source link in its author's own reply reach the
    resolution together whichever entry read them. Exactly one hop: a parent's
    own parent is never read, and a parent by another author is never joined to
    the thread, whatever it holds.

    ``handle`` is the author handle the caller already holds; see
    :func:`record_by_id`. The post itself raises what ``fetch_syndication``
    raises; the parent leg and the chase are fail-soft.
    """
    return acquire_from_post(record_by_id(tweet_id, handle=handle, client=client), client=client)


def read_pasted_post(url: str, *, client: httpx.Client | None = None) -> TweetRecord:
    """The post a pasted URL names, read alone.

    The URL is parsed once here (:func:`urls.normalise_tweet_url`, which raises
    ``InvalidTweetUrl``) and one syndication call reads the post. The rest of
    the hop is :func:`acquire_from_post`, so the paste can check whose post it
    is before it fetches anything the URL merely points at.
    """
    normalised = normalise_tweet_url(url)
    return record_by_id(normalised.tweet_id, handle=normalised.handle, client=client)


def acquire_pasted_thread(url: str, *, client: httpx.Client | None = None) -> AcquiredThread:
    """The thread behind a pasted post URL.

    The paste's twin of the bot's ``acquire_tagged_thread``: the URL is parsed
    once, the post is read, then the shared one hop adds the same author's post
    it replies to. ``detection.import_pasted_post`` runs the two halves itself,
    with the own-post check between them; this composition is what the paste's
    contract test reads.
    """
    return acquire_from_post(read_pasted_post(url, client=client), client=client)
