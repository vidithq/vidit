"""Normalized acquire unit — one tweet, source-agnostic.

``TweetRecord`` is what every acquire adapter produces (syndication for the
preview, the archive reader for backfill) and what ``stitch`` consumes. The
unit is a normalized record, not a bare id, so the archive's inline reply
edges and media survive into the pipeline — syndication cannot expose either.
"""

from __future__ import annotations

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
class SourceLink:
    """A source URL the OP links (``entities.urls``) plus its host class.

    ``host``: ``x`` (a status, chaseable for its media / date), ``telegram`` /
    ``youtube`` (off-platform, media not retrievable), or ``other``.
    """

    url: str
    host: str


@dataclass(frozen=True)
class TweetRecord:
    tweet_id: str
    # Author handle, normalized: lowercase, no leading ``@``. The detection is
    # owned by this handle's user.
    handle: str
    text: str
    created_at: str  # ISO 8601 UTC
    # Canonical permalink ``https://x.com/<handle>/status/<id>`` — always
    # present, so it anchors the ``(detected_from_url, coordinate)`` idempotency
    # where ``source_url`` (the footage origin) may be absent.
    permalink: str
    media: list[ParsedMedia] = field(default_factory=list)
    # Reply edges — present from an archive (inline), ``None`` from syndication
    # (one fetch returns one tweet without its chain). ``stitch`` unions on them.
    in_reply_to_status_id: str | None = None
    in_reply_to_user_id: str | None = None
    # The quoted tweet, resolved inline (syndication) or joined / chased
    # (archive). The footage source in the common OSINT quote pattern.
    quoted: QuotedTweet | None = None
    # Source URLs the OP links in its text (``entities.urls``), host-classified.
    external_sources: list[SourceLink] = field(default_factory=list)
