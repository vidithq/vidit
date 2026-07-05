"""Human pre-fill: pasted tweet URL → ``ParsedTweet`` for the submit form.

Backs ``POST /events/import-from-tweet``. A thin mapper over the shared
``resolve_tweet`` core (the same one the machine ``detect`` path runs), so the
human pre-fill and the machine detection never drift on coordinates, source, or
media. This module only reshapes ``ResolvedTweet`` into the form-facing payload.
The analyst always reviews and submits; nothing auto-publishes.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .errors import TweetFetchFailed
from .extract import ParsedCoord
from .resolve import resolve_tweet
from .syndication import ParsedMedia, ParsedQuotedTweet


@dataclass(frozen=True)
class ParsedTweet:
    # The SOURCE: the quoted tweet's URL when the OP quote-retweets, else
    # the OP's own. The OP is rarely the real source in OSINT (messenger,
    # not footage source), so the frontend uses this as the ``source_url``
    # form field.
    source_url: str
    # The OP's URL, kept so the frontend can cite the analyst in the proof
    # body even when ``source_url`` points at the quoted source.
    original_tweet_url: str
    posted_at: str  # ISO 8601 UTC
    author_handle: str
    tweet_text: str
    suggested_title: str
    parsed_coords: list[ParsedCoord]
    # All media from the OP + the quoted tweet; each entry's ``origin`` tells
    # the frontend primary (``quote``) vs proof (``op``). See ``ParsedMedia``.
    media: list[ParsedMedia]
    quoted_tweet: ParsedQuotedTweet | None


def parse_tweet(url: str, *, client: httpx.Client | None = None) -> ParsedTweet:
    """Resolve ``url`` into the shared ``ResolvedTweet``, then reshape it for the
    submit form.

    The resolution (fetch, quoted tweet, source links, coordinate fallback,
    source URL) is the same one the machine path runs; only the empty-``created_at``
    guard is human-path specific, since the form needs a real posted-at. The
    optional ``client`` is for tests (an ``httpx.Client`` on a ``MockTransport``).
    """
    resolved = resolve_tweet(url, client=client)
    if resolved is None or not resolved.created_at:
        raise TweetFetchFailed("upstream missing created_at")

    # ``/i/web/status/...`` yields no handle in URL or response: render "@unknown".
    author_handle = "" if resolved.owner_handle == "i" else resolved.owner_handle

    quoted_tweet: ParsedQuotedTweet | None = None
    media: list[ParsedMedia] = list(resolved.op_media)
    if resolved.quoted is not None:
        quoted = resolved.quoted
        quoted_tweet = ParsedQuotedTweet(
            source_url=f"https://x.com/{quoted.handle}/status/{quoted.tweet_id}",
            author_handle=quoted.handle,
            tweet_text=quoted.text,
        )
        media.extend(quoted.media)

    return ParsedTweet(
        source_url=resolved.source_url,
        original_tweet_url=resolved.detected_from_url,
        posted_at=resolved.created_at,
        author_handle=author_handle,
        tweet_text=resolved.text,
        suggested_title=resolved.title,
        parsed_coords=resolved.coords,
        media=media,
        quoted_tweet=quoted_tweet,
    )
