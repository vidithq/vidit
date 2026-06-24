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
