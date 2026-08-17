"""Acquire a tweet, and the post it replies to, via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``. ``acquire_thread`` is the
one acquisition the live entries share (the bot's tagged mention and the pasted
tweet): it reads the post named by a tweet id plus, when that post replies to
one of its own author's, that parent. Exactly one hop, and only within one
author, so the result is a thread ``resolve_thread`` reads as the analyst's own
work. It then chases the thread's sole source candidate through
``chase.chase_post``, the way the archive reader chases its own, so the
resolution downstream is pure and neither knows which technology answered. The
archive keeps its own reader: an export carries every reply edge inline, so it
stitches whole self-threads without a fetch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .chase import apply_chase, chase_post
from .errors import TweetImportError
from .records import QuotedTweet, SourceLink, TweetRecord
from .syndication import _extract_media, extract_source_links, fetch_syndication
from .urls import normalise_tweet_url


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
    in_reply_to_user = body.get("in_reply_to_user_id_str")
    return TweetRecord(
        tweet_id=tweet_id,
        handle=author,
        text=text if isinstance(text, str) else "",
        created_at=created_at if isinstance(created_at, str) else "",
        media=list(_extract_media(body, origin="op")),
        in_reply_to_status_id=(in_reply_to_status if isinstance(in_reply_to_status, str) else None),
        in_reply_to_user_id=in_reply_to_user if isinstance(in_reply_to_user, str) else None,
        quoted=_quoted_record(body),
        external_sources=[SourceLink(url=u, shortlink=t) for u, t in extract_source_links(body)],
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
        parent = record_by_id(post.in_reply_to_status_id, handle=post.handle, client=client)
    except TweetImportError:
        return None
    if parent.handle.lower() != post.handle.lower():
        return None
    return parent


def _chase_source(
    records: list[TweetRecord], *, client: httpx.Client | None = None
) -> list[TweetRecord]:
    """Resolve the thread's sole source candidate onto the record that carries
    it, at most one fetch.

    ``chase.chase_post`` decides what a link's host makes fetchable, so nothing
    here names a technology: a link the dispatcher serves comes back as a
    ``ChasedPost`` and lands in whichever record slot fits. A link it does not
    serve stays link-only, and so does an ambiguous thread (several candidates,
    no source), the same rule the archive reader applies on the export side.
    Fail-soft: a failed fetch changes nothing.
    """
    from .resolve import thread_candidates

    if any(record.quoted is not None for record in records):
        return records
    candidates = thread_candidates(records)
    if len(candidates) != 1:
        return records
    candidate = candidates[0]
    chased = chase_post(candidate, client=client)
    if chased is None:
        return records
    owner = records[0].handle.lower() if records else ""
    if chased.author is not None and chased.author.lower() == owner:
        # A link to the analyst's own post that slipped the URL-level own-handle
        # skip (the ``i/web`` form) is a self-reference, not footage; the same
        # re-check the archive chase runs.
        return records
    return [
        apply_chase(record, chased)
        if any(link.url == candidate for link in record.external_sources)
        else record
        for record in records
    ]


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
    post = record_by_id(tweet_id, handle=handle, client=client)
    parent = _self_reply_parent(post, client=client)
    records = _chase_source([parent, post] if parent is not None else [post], client=client)
    return AcquiredThread(records=records, post=post, parent=parent)


def acquire_pasted_thread(url: str, *, client: httpx.Client | None = None) -> AcquiredThread:
    """The thread behind a pasted post URL.

    The paste's twin of the bot's ``acquire_tagged_thread``: the URL is parsed
    once here (:func:`urls.normalise_tweet_url`, which raises
    ``InvalidTweetUrl``), then the shared one hop reads the post and, when it
    replies to one of its own author's posts, that parent.
    """
    normalised = normalise_tweet_url(url)
    return acquire_thread(normalised.tweet_id, handle=normalised.handle, client=client)
