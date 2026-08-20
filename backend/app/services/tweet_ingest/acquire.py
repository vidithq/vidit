"""Acquire a tweet, and the posts above it, via syndication → ``TweetRecord``.

The syndication sibling of ``archive.read_tweets``. ``acquire_thread`` is the
one acquisition the live entries share (the bot's tagged mention and the pasted
tweet): it reads the post named by a tweet id plus, when that post replies to
one of its own author's, that parent. A post carrying content of its own stops
there, one hop. A post carrying nothing but mentions is a pointer rather than
content (the bare ``@ViditBot`` tag an analyst drops under their own thread), so
it re-anchors: the climb follows same-author parents until one of them carries a
coordinate, then takes one more parent above it, capped at
:data:`_BARE_TAG_MAX_CLIMB` fetches. Either way the climb stays inside one
author, so the result is a thread ``resolve_threads`` reads as the analyst's own
work. It then runs ``chase.chase_thread`` over that thread, the same one chase
step the archive backfill runs over each stitched self-thread, so the resolution
downstream is pure and neither knows which technology answered. The archive
keeps its own reader: an export carries every reply edge inline, so it stitches
whole self-threads without a fetch.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import httpx

from .chase import chase_thread
from .errors import TweetImportError
from .extract import scan_coords
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
    """What one acquisition yields.

    ``records`` is the thread ``resolve_threads`` reads, parents first then the
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


# A mention as X writes it: ``@`` plus 1 to 15 word characters, the handle
# grammar the platform enforces.
_MENTION_RE = re.compile(r"@[A-Za-z0-9_]{1,15}")

# How many parent fetches a bare tag may spend climbing. Three is the field
# shape it exists for: the tag under a source reply, the coordinate post above
# that, and the footage post the coordinate post itself replies to. It bounds
# what one pointer costs the shared syndication budget, and a climb that spends
# it without meeting a coordinate keeps what it read, so the resolution refuses
# ``coords_missing`` on the analyst's own words rather than on a fetch limit.
_BARE_TAG_MAX_CLIMB = 3


def _is_bare_tag(post: TweetRecord) -> bool:
    """Whether ``post`` carries nothing of its own beyond mentions.

    Addressing is not content: a reply whose text is mentions and whitespace,
    with no media and no quoted post, says only "read the thread above me". Any
    text the analyst wrote around the tag (a coordinate, a source line, a
    correction) makes the post content, and content is read where it sits.
    """
    return (
        not post.media
        and post.quoted_status_id is None
        and not _MENTION_RE.sub("", post.text).strip()
    )


def _climb_to_coords(post: TweetRecord, *, client: httpx.Client | None = None) -> list[TweetRecord]:
    """The same-author posts above a bare tag, earliest first.

    One fetch per parent, capped at :data:`_BARE_TAG_MAX_CLIMB`. The climb stops
    on the first parent whose text carries a coordinate and then reads one post
    further, since the coordinate post replies to the footage it geolocates in
    the thread shape this serves; that extra read is inside the cap. Every post
    climbed through joins the thread, so a source line between the tag and the
    coordinate still reaches the resolution. Same-author only
    (:func:`_self_reply_parent`), which is what stops the climb at someone
    else's post and what keeps a courtesy tag under the bot's own reply from
    climbing at all.
    """
    climbed: list[TweetRecord] = []
    current = post
    for spent in range(_BARE_TAG_MAX_CLIMB):
        parent = _self_reply_parent(current, client=client)
        if parent is None:
            break
        climbed.append(parent)
        current = parent
        if scan_coords(parent.text).coords:
            if spent + 1 < _BARE_TAG_MAX_CLIMB:
                above = _self_reply_parent(parent, client=client)
                if above is not None:
                    climbed.append(above)
            break
    climbed.reverse()
    return climbed


def acquire_from_post(post: TweetRecord, *, client: httpx.Client | None = None) -> AcquiredThread:
    """The rest of the acquisition over a post already read: the same author's
    posts above it, then the chase.

    A post with content of its own takes one hop, its same-author parent. A bare
    tag (:func:`_is_bare_tag`) takes the climb instead (:func:`_climb_to_coords`),
    because the analyst pointed at the thread rather than typing in it.

    Split from :func:`acquire_thread` so a caller holding an ownership rule can
    settle it on ``post`` alone, before this spends anything further. Both legs
    are fail-soft: a parent that will not fetch reads as no parent, and a
    footage link that will not chase reads as no footage.
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
    """The post ``tweet_id``, plus the same author's posts above it, with the
    thread's sole source candidate chased.

    The one acquisition the bot and the pasted-tweet import share, so a
    coordinate in a post and a source link in its author's own reply reach the
    resolution together whichever entry read them. A post with content of its
    own reads one hop and no further. A bare tag reads the climb
    (:func:`acquire_from_post`), at most :data:`_BARE_TAG_MAX_CLIMB` parents. A
    parent by another author is never joined to the thread whatever it holds,
    and it ends the climb.

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
    once, the post is read, then the shared acquisition adds the same author's
    posts above it. ``detection.import_pasted_post`` runs the two halves itself,
    with the own-post check between them; this composition is what the paste's
    contract test reads.
    """
    return acquire_from_post(read_pasted_post(url, client=client), client=client)
