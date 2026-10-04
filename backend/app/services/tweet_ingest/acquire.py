"""Acquire a tweet, and the posts above it, via syndication into ``TweetRecord``s.

The syndication sibling of ``archive.read_tweets``. :func:`acquire_thread` is the
acquisition the bot's tagged mention and the pasted tweet share. It reads the
post plus its same-author parent, then runs ``chase.chase_thread``. A post with
content of its own stops at one hop. A post of only mentions is a pointer (the
bare ``@ViditBot`` tag under the analyst's own thread), so the climb follows
same-author parents until one carries a coordinate, then reads one post further
for footage if that post has no media, capped at :data:`_BARE_TAG_MAX_CLIMB`
fetches. The thread stays inside one author.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .chase import chase_thread
from .errors import TweetImportError
from .extract import is_mentions_only, scan_coords
from .records import QuotedTweet, SourceLink, TweetRecord, expand_shortlinks
from .syndication import extract_media, extract_source_links, fetch_syndication
from .urls import normalise_tweet_url


def _quoted_status_id(body: dict[str, Any]) -> str | None:
    """The id of the post ``body`` quotes, or ``None``."""
    qt = body.get("quoted_tweet")
    tweet_id = qt.get("id_str") if isinstance(qt, dict) else None
    return tweet_id if isinstance(tweet_id, str) and tweet_id else None


def _quoted_record(body: dict[str, Any]) -> QuotedTweet | None:
    """The inline quoted tweet as a sub-record (the body embeds it, no extra fetch)."""
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
        external_sources=[SourceLink(url=u, shortlink=t) for u, t in extract_source_links(qt)],
    )


def record_by_id(tweet_id: str, *, handle: str, client: httpx.Client | None = None) -> TweetRecord:
    """Fetch the post ``tweet_id`` via syndication as a ``TweetRecord``.

    ``handle`` is the caller's known author handle, a fallback: the response's
    screen name wins (authoritative, and the only source for a
    ``/i/web/status/<id>`` URL). ``client`` is for tests. Raises what
    ``fetch_syndication`` raises.
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
    """What one acquisition yields.

    ``records`` is the thread ``resolve_threads`` reads, parents first (the head
    carries the provenance). ``post`` is the record for the id the caller
    named, whose author the paste checks against the caller's linked handle.
    """

    records: list[TweetRecord]
    post: TweetRecord


def _self_reply_parent(
    post: TweetRecord, *, client: httpx.Client | None = None
) -> TweetRecord | None:
    """The parent ``post`` replies to, when it has the same author.

    One fetch. The guard runs on the fetched handle (authoritative), which stops
    an analyst claiming a geolocation posted under someone else's footage.
    Fail-soft: a failure reads as no parent.
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


# Parent fetches a bare tag may spend: the source reply, the coordinate post,
# and the footage post above it. It bounds the shared syndication budget; a
# climb that finds no coordinate keeps what it read (``coords_missing``). A
# coordinate met on the last fetch ends the read, so no footage post is fetched.
_BARE_TAG_MAX_CLIMB = 3


def _is_bare_tag(post: TweetRecord) -> bool:
    """Whether ``post`` is only mentions (:func:`extract.is_mentions_only`), no
    media and no quote, which says "read the thread above me".

    Residue keeps a post contentful on purpose: a dot-mention (``.@viditbot``)
    leaves its period, reads as content and takes one hop. Misreading a pointer
    costs a refusal the analyst can fix by tagging again; the reverse spends
    fetches on posts they did not point at.
    """
    return not post.media and post.quoted_status_id is None and is_mentions_only(post.text)


def _carries_coordinate(record: TweetRecord) -> bool:
    """Whether ``record`` is a post the analyst wrote a coordinate in.

    Scans the expanded text (a Maps link is an opaque ``t.co`` in the raw text).
    An out-of-bounds coordinate counts (``CoordScan.out_of_bounds``), turning a
    typo into ``coords_invalid`` instead of a walk past it.
    """
    scan = scan_coords(expand_shortlinks(record.text, record.external_sources))
    return bool(scan.coords) or scan.out_of_bounds


def _climb_to_coords(post: TweetRecord, *, client: httpx.Client | None = None) -> list[TweetRecord]:
    """The same-author posts above a bare tag, earliest first.

    One fetch per parent, within :data:`_BARE_TAG_MAX_CLIMB`. The climb stops at
    the first parent carrying a coordinate. If it has media, the read ends.
    Otherwise one more post is read and joined only when it has media and no
    coordinate (one with a coordinate is a separate geolocation; one with
    neither adds only links, which can make the source ambiguous).

    Every post climbed through joins the thread. Same-author only
    (:func:`_self_reply_parent`), which also keeps a courtesy tag under the
    bot's own reply from climbing.
    """
    climbed: list[TweetRecord] = []
    current = post
    remaining = _BARE_TAG_MAX_CLIMB
    anchored = False
    while remaining > 0 and not anchored:
        remaining -= 1
        parent = _self_reply_parent(current, client=client)
        if parent is None:
            break
        climbed.append(parent)
        current = parent
        anchored = _carries_coordinate(parent)
    if anchored and not current.media and remaining > 0:
        above = _self_reply_parent(current, client=client)
        if above is not None and above.media and not _carries_coordinate(above):
            climbed.append(above)
    climbed.reverse()
    return climbed


def acquire_from_post(post: TweetRecord, *, client: httpx.Client | None = None) -> AcquiredThread:
    """The acquisition over a post already read: same-author posts above it, then the chase.

    A post with content takes one hop; a bare tag (:func:`_is_bare_tag`) takes
    the climb (:func:`_climb_to_coords`). Split from :func:`acquire_thread` so a
    caller can settle an ownership rule on ``post`` before anything more is
    fetched. Both legs are fail-soft.
    """
    if _is_bare_tag(post):
        above = _climb_to_coords(post, client=client)
    else:
        parent = _self_reply_parent(post, client=client)
        above = [parent] if parent is not None else []
    records = chase_thread([*above, post], client=client)
    return AcquiredThread(records=records, post=post)


def acquire_thread(
    tweet_id: str, *, handle: str, client: httpx.Client | None = None
) -> AcquiredThread:
    """The post ``tweet_id`` plus the same author's posts above it, chased.

    Shared by the bot and the pasted-tweet import (:func:`acquire_from_post`
    has the hop and climb rules). A parent by another author is never joined
    and ends the climb. ``handle`` is as in :func:`record_by_id`. The post
    itself raises what ``fetch_syndication`` raises; the rest is fail-soft.
    """
    return acquire_from_post(record_by_id(tweet_id, handle=handle, client=client), client=client)


def read_pasted_post(url: str, *, client: httpx.Client | None = None) -> TweetRecord:
    """The post a pasted URL names, read alone (raises ``InvalidTweetUrl``).

    The rest is :func:`acquire_from_post`, so the paste can check whose post it
    is first.
    """
    normalised = normalise_tweet_url(url)
    return record_by_id(normalised.tweet_id, handle=normalised.handle, client=client)


def acquire_pasted_thread(url: str, *, client: httpx.Client | None = None) -> AcquiredThread:
    """The thread behind a pasted post URL.

    ``detection.import_pasted_post`` runs the two halves itself with the
    own-post check between; this composition is read by the paste's contract test.
    """
    return acquire_from_post(read_pasted_post(url, client=client), client=client)
