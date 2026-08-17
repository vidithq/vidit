"""Acquire a tweet, and the post it replies to, via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``. ``acquire_thread`` is the
one acquisition the live entries share (the bot's tagged mention and the pasted
tweet): it reads the post named by a tweet id plus, when that post replies to
one of its own author's, that parent. Exactly one hop, and only within one
author, so the result is a thread ``resolve_thread`` reads as the analyst's own
work. It then chases the thread's sole source candidate, the way the archive
reader chases its own, so the resolution downstream is pure. The archive keeps
its own reader: an export carries every reply edge inline, so it stitches whole
self-threads without a fetch.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any

import httpx

from .errors import TweetFetchFailed, TweetImportError, TweetNotAccessible
from .records import QuotedTweet, SourceLink, TelegramFootage, TweetRecord
from .syndication import (
    _extract_media,
    extract_source_links,
    fetch_syndication,
)
from .telegram import fetch_telegram_embed


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

    The one chase every linked-source path runs: the live acquisition below and
    the archive backfill with ``chase`` on. Fail-soft: a fetch error degrades to
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


def _chase_source(
    records: list[TweetRecord], *, client: httpx.Client | None = None
) -> list[TweetRecord]:
    """Resolve the thread's sole source candidate onto the record that carries
    it, at most one fetch.

    The chase vocabulary, and the only thing the X / Telegram names decide: an X
    status chases via syndication into the ``quoted`` slot (media plus post
    date), a ``t.me`` post chases its public embed into the ``telegram`` slot
    (post date, media when the embed serves it). Every other link stays
    link-only, and so does an ambiguous thread (several candidates, no source),
    which is the same rule ``archive._chase_candidate`` applies on the export
    side. Fail-soft: a failed fetch changes nothing.
    """
    from .resolve import thread_candidates

    if any(record.quoted is not None for record in records):
        return records
    candidates = thread_candidates(records)
    if len(candidates) != 1:
        return records
    candidate = candidates[0]
    owner = records[0].handle.lower() if records else ""
    if candidate.status_id is not None:
        quoted = quoted_from_syndication(candidate.status_id, client=client)
        if quoted is None or quoted.handle.lower() == owner:
            # A link to the analyst's own status that slipped the URL-level
            # own-handle skip (the ``i/web`` form) is a self-reference, not
            # footage; the same re-check the archive chase runs.
            return records
        return _with_chase(records, candidate.url, quoted=quoted)
    if candidate.telegram:
        embed = fetch_telegram_embed(candidate.url, client=client)
        if embed is None:
            return records
        return _with_chase(
            records,
            candidate.url,
            telegram=TelegramFootage(
                url=candidate.url, posted_at=embed.posted_at, media=list(embed.media)
            ),
        )
    return records


def _with_chase(
    records: list[TweetRecord],
    url: str,
    *,
    quoted: QuotedTweet | None = None,
    telegram: TelegramFootage | None = None,
) -> list[TweetRecord]:
    """``records`` with the chased footage attached to the record that links
    ``url``, so the resolution reads the source off the post that declared it."""
    return [
        (
            dataclasses.replace(record, quoted=quoted or record.quoted, telegram=telegram)
            if any(link.url == url for link in record.external_sources)
            else record
        )
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
