"""The live acquisition: a post and the same author's posts above it, read through syndication."""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any

import httpx

from .chase import chase_thread
from .errors import TweetFetchFailed, TweetNotAccessible
from .extract import is_mentions_only, scan_coords
from .records import SourcePost, TweetRecord, expand_shortlinks
from .resolve import COORDS_MISSING, THREAD_TRUNCATED, Resolution, resolve_threads
from .syndication import extract_media, extract_source_links, fetch_syndication, source_post
from .urls import normalise_tweet_url


def _quoted_status_id(body: dict[str, Any]) -> str | None:
    qt = body.get("quoted_tweet")
    tweet_id = qt.get("id_str") if isinstance(qt, dict) else None
    return tweet_id if isinstance(tweet_id, str) and tweet_id else None


def _quoted_record(body: dict[str, Any]) -> SourcePost | None:
    """The inline quoted post (the body embeds it, no extra fetch)."""
    qt = body.get("quoted_tweet")
    tweet_id = _quoted_status_id(body)
    if not isinstance(qt, dict) or tweet_id is None:
        return None
    post = source_post(qt, tweet_id)
    if post is None:
        return None
    return dataclasses.replace(post, external_sources=extract_source_links(qt))


def record_by_id(tweet_id: str, *, handle: str, client: httpx.Client | None = None) -> TweetRecord:
    """The post ``tweet_id`` read through syndication; raises what ``fetch_syndication`` raises.

    ``handle`` is a fallback: the response's screen name wins (authoritative, and the only
    source for a ``/i/web/status/<id>`` URL).
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
        external_sources=extract_source_links(body),
    )


@dataclass(frozen=True)
class AcquiredThread:
    """What one acquisition yields: the thread, parents first (the head carries the
    provenance), and whether the search for the coordinate stopped before the thread ended."""

    records: list[TweetRecord]
    truncated: bool = False

    def resolve(self, *, with_requests: bool = False) -> Resolution:
        """``resolve_threads`` over :attr:`records`; a truncated read refuses ``THREAD_TRUNCATED``
        instead of ``COORDS_MISSING`` and drafts no request."""
        resolution = resolve_threads([self.records], with_requests=with_requests)
        if self.truncated and resolution.reason == COORDS_MISSING:
            return Resolution(refusals={THREAD_TRUNCATED: 1})
        return resolution


def _self_reply_parent(
    post: TweetRecord, *, client: httpx.Client | None = None
) -> TweetRecord | None:
    """The parent ``post`` replies to, when it has the same author; a gone or restricted
    parent reads as none. The guard runs on the fetched handle, which is authoritative."""
    if post.in_reply_to_status_id is None:
        return None
    try:
        parent = record_by_id(post.in_reply_to_status_id, handle=post.handle, client=client)
    except TweetNotAccessible:
        return None
    if parent.handle.lower() != post.handle.lower():
        return None
    return parent


# Parent fetches a bare tag may spend: the source reply, the coordinate post, and the footage
# post above it. It bounds the shared syndication budget.
_BARE_TAG_MAX_CLIMB = 3


def _is_bare_tag(post: TweetRecord) -> bool:
    """Whether ``post`` is only mentions, no media and no quote.

    Residue keeps a post contentful on purpose: a dot-mention (``.@viditbot``) takes one hop.
    Misreading a pointer costs a refusal the analyst fixes by tagging again; the reverse
    spends fetches on posts they did not point at.
    """
    return not post.media and post.quoted_status_id is None and is_mentions_only(post.text)


def _carries_coordinate(record: TweetRecord) -> bool:
    """Whether ``record`` carries a coordinate in its expanded text (a Maps link is an opaque
    ``t.co`` in the raw one). An out-of-bounds one counts, so a typo reads ``coords_invalid``."""
    scan = scan_coords(expand_shortlinks(record.text, record.external_sources))
    return bool(scan.coords) or scan.out_of_bounds


def _climb_to_coords(
    post: TweetRecord, *, client: httpx.Client | None = None
) -> tuple[list[TweetRecord], bool]:
    """The same-author posts above a bare tag, earliest first, and whether the climb was cut
    before it met a coordinate. ``docs/ingestion.md`` states where the climb stops."""
    climbed: list[TweetRecord] = []
    current = post
    remaining = _BARE_TAG_MAX_CLIMB
    anchored = False
    truncated = False
    while not anchored:
        if remaining == 0:
            truncated = current.in_reply_to_status_id is not None
            break
        remaining -= 1
        try:
            parent = _self_reply_parent(current, client=client)
        except TweetFetchFailed:
            truncated = True
            break
        if parent is None:
            break
        climbed.append(parent)
        current = parent
        anchored = _carries_coordinate(parent)
    if anchored and not current.media and remaining > 0:
        try:
            above = _self_reply_parent(current, client=client)
        except TweetFetchFailed:
            # The coordinate is read; a lost footage post only leaves the slot empty.
            above = None
        if above is not None and above.media and not _carries_coordinate(above):
            climbed.append(above)
    climbed.reverse()
    return climbed, truncated


def acquire_from_post(post: TweetRecord, *, client: httpx.Client | None = None) -> AcquiredThread:
    """The acquisition over a post already read: same-author posts above it, then the chase.

    Split from :func:`acquire_thread` so the paste settles whose post it is before anything
    more is fetched.
    """
    truncated = False
    if _is_bare_tag(post):
        above, truncated = _climb_to_coords(post, client=client)
    else:
        try:
            parent = _self_reply_parent(post, client=client)
        except TweetFetchFailed:
            parent, truncated = None, True
        above = [parent] if parent is not None else []
    records = chase_thread([*above, post], client=client)
    return AcquiredThread(records=records, truncated=truncated)


def acquire_thread(
    tweet_id: str, *, handle: str, client: httpx.Client | None = None
) -> AcquiredThread:
    """The post ``tweet_id`` plus the same author's posts above it, chased.

    The post itself raises what ``fetch_syndication`` raises; the rest is fail-soft.
    """
    return acquire_from_post(record_by_id(tweet_id, handle=handle, client=client), client=client)


def read_pasted_post(url: str, *, client: httpx.Client | None = None) -> TweetRecord:
    """The post a pasted URL names, read alone (raises ``InvalidTweetUrl``)."""
    normalised = normalise_tweet_url(url)
    return record_by_id(normalised.tweet_id, handle=normalised.handle, client=client)
