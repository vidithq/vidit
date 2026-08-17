"""Normalized acquire unit: one tweet, source-agnostic.

``TweetRecord`` is what every acquire adapter produces (syndication for the
preview, the archive reader for backfill) and what ``stitch`` consumes. The
unit is a normalized record, not a bare id, so the archive's inline reply
edges and media survive into the pipeline, which syndication cannot expose.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from .syndication import ParsedMedia


@dataclass(frozen=True)
class QuotedTweet:
    """The tweet quoted by the OP, resolved to a full sub-record.

    In OSINT the analyst quote-tweets the footage and adds the coordinate, so
    the quoted tweet is usually the real source: its media is the footage and
    its ``created_at`` is the true source post time. Carried on the record so
    ``detect`` / ``parse`` attribute the source without a second fetch.
    """

    tweet_id: str
    handle: str
    text: str
    created_at: str  # ISO 8601 UTC
    media: list[ParsedMedia] = field(default_factory=list)


@dataclass(frozen=True)
class TelegramFootage:
    """An off-platform Telegram footage source, chased from its public embed.

    Parallel to ``quoted`` but deliberately not a ``QuotedTweet``: a t.me post is
    not a tweet (no handle / text we model), only a post date and, when the embed
    serves it, the footage media. Carried on the record so ``resolve_source`` /
    ``split_media`` attribute the date + media without a second fetch. ``url`` is
    the footage link the source resolved to; it must equal the resolved
    ``SourceLink.url`` for the resolution to pick this footage up.
    """

    url: str
    posted_at: str | None  # ISO 8601 UTC, None when the embed omitted the date
    media: list[ParsedMedia] = field(default_factory=list)


@dataclass(frozen=True)
class SourceLink:
    """A URL the post links (``entities.urls``).

    ``shortlink`` is the wrapper token as it appears in the raw tweet text
    (the ``t.co`` form from the entity's ``url`` field), ``None`` when the
    adapter had none. It is what expands the link back to a readable URL in the
    stored proof.
    """

    url: str
    shortlink: str | None = None


# A line carrying URL tokens and nothing else. Read by the title rule, which
# never picks such a line.
_URL_TOKENS_LINE_RE = re.compile(r"^\s*https?://\S+(?:\s+https?://\S+)*\s*$", re.IGNORECASE)


def url_only_tokens(line: str) -> list[str] | None:
    """``line``'s URL tokens when the line is nothing but URL tokens, ``None``
    otherwise (a word, a stray character, an empty line).

    Several tokens still match: X appends the wrapper of the post's own attached
    media behind whatever the analyst wrote, so a one-link line reaches storage
    as two tokens.
    """
    return line.split() if _URL_TOKENS_LINE_RE.match(line) else None


def expand_shortlinks(text: str, links: Iterable[SourceLink]) -> str:
    """Replace each entity's opaque ``t.co`` token in ``text`` with its expanded
    URL, so an analyst's reference link survives readable in the stored proof.

    Tokens with no entity (the wrapper X appends for attached media) stay for
    ``clean_proof_text`` to strip.
    """
    for link in links:
        if link.shortlink:
            text = text.replace(link.shortlink, link.url)
    return text


@dataclass(frozen=True)
class TweetRecord:
    tweet_id: str
    # Author handle, normalized: lowercase, no leading ``@``. The detection is
    # owned by this handle's user.
    handle: str
    text: str
    created_at: str  # ISO 8601 UTC
    # Canonical permalink ``https://x.com/<handle>/status/<id>``, always
    # present, so it anchors the ``(detected_from_url, coordinate)`` idempotency
    # where ``source_url`` (the footage origin) may be absent.
    permalink: str
    media: list[ParsedMedia] = field(default_factory=list)
    # Reply edges — inline from an archive; from syndication the parent pointer
    # maps when the payload carries it (the chain itself still takes one fetch
    # per parent, the bot's walk). ``stitch`` unions on them.
    in_reply_to_status_id: str | None = None
    in_reply_to_user_id: str | None = None
    # The quoted tweet, resolved inline (syndication) or joined / chased
    # (archive). The footage source in the common OSINT quote pattern.
    quoted: QuotedTweet | None = None
    # A chased Telegram footage source (date + maybe media), parallel to
    # ``quoted``. Populated by the archive chase when the OP's sole footage link
    # is a t.me post; ``None`` on every non-chasing path.
    telegram: TelegramFootage | None = None
    # The URLs the post links in its text (``entities.urls``).
    external_sources: list[SourceLink] = field(default_factory=list)
