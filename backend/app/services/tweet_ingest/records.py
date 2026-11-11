"""Normalized acquire units: the tweet, the post it names as its source, a chase's answer."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Literal

from .urls import canonical_tweet_url

MediaKind = Literal["image", "video"]

# The one type an imported photo is stored under. Ingest re-encodes it
# (``storage.prepare_media``), so it must match
# ``evidence_processing.DERIVATIVE_CONTENT_TYPE`` (``test_ingest_media_types``).
PHOTO_CONTENT_TYPE = "image/jpeg"

# Videos are stored as fetched (every reader picks an mp4 variant,
# ``syndication.media_entry``).
VIDEO_CONTENT_TYPE = "video/mp4"


@dataclass(frozen=True)
class ParsedMedia:
    """One image or video a post carries.

    ``remote_url`` is a CDN URL on live paths, an archive-relative
    ``tweets_media/`` path on the export path.
    """

    kind: MediaKind
    remote_url: str
    # Informational only: the primary-vs-proof split is by ``kind`` (videos are
    # source footage, images annotated screenshots). Do not assume one origin
    # maps to one bucket.
    origin: Literal["op", "quote"] = "op"

    @property
    def content_type(self) -> str:
        """The stored type, derived from ``kind`` alone (never from a payload)."""
        return PHOTO_CONTENT_TYPE if self.kind == "image" else VIDEO_CONTENT_TYPE


@dataclass(frozen=True)
class SourceLink:
    """A URL the post links (``entities.urls``).

    ``shortlink`` is the ``t.co`` token as it appears in the raw text, ``None``
    when the adapter had none; it expands back to ``url`` in the stored proof.
    """

    url: str
    shortlink: str | None = None


def expand_shortlinks(text: str, links: Iterable[SourceLink]) -> str:
    """Replace each entity's ``t.co`` token in ``text`` with its URL.

    Tokens with no entity (X's attached-media wrapper) stay for
    ``clean_proof_text`` to strip.
    """
    for link in links:
        if link.shortlink:
            text = text.replace(link.shortlink, link.url)
    return text


@dataclass(frozen=True)
class SourcePost:
    """A post a thread names as its source: a quoted X post, or the post one chase resolved.

    ``url`` is the canonical permalink for an X post (:meth:`x_status`) and the
    target as written for any other host, so the resolution matches it back to
    the declared link. ``status_id`` and ``author`` are set only for X.
    """

    url: str
    posted_at: str | None = None  # ISO 8601 UTC, None when the post serves none
    media: list[ParsedMedia] = field(default_factory=list)
    status_id: str | None = None
    author: str | None = None
    text: str = ""
    # Read only by the request branch's coordinate scan (raw text holds opaque
    # ``t.co`` wrappers). Never a source candidate (:func:`resolve.thread_candidates`).
    external_sources: list[SourceLink] = field(default_factory=list)

    @classmethod
    def x_status(cls, status_id: str, author: str, **fields: Any) -> SourcePost:
        return cls(
            url=canonical_tweet_url(status_id, author),
            status_id=status_id,
            author=author,
            **fields,
        )


@dataclass(frozen=True)
class TweetRecord:
    tweet_id: str
    # Lowercase, no leading ``@``. The detection is owned by this handle's user.
    handle: str
    text: str
    created_at: str  # ISO 8601 UTC
    media: list[ParsedMedia] = field(default_factory=list)
    # Reply edge: inline from an archive, from syndication when the payload has
    # the parent pointer. ``stitch`` unions on it.
    in_reply_to_status_id: str | None = None
    # Resolved inline (syndication) or joined in the export (archive).
    quoted: SourcePost | None = None
    # The quoted post's id, when declared. Differs from ``quoted`` only where
    # resolving it takes a fetch (``chase.chase_thread`` reads it).
    quoted_status_id: str | None = None
    # Filled by ``chase.chase_thread`` when the sole footage link is off X.
    linked: SourcePost | None = None
    external_sources: list[SourceLink] = field(default_factory=list)
    # Why the chase found no footage, stamped by ``chase.chase_thread``: carries a swallowed
    # failure to the pure resolution, which tells "not readable now" from "no footage".
    chase_outcome: ChaseOutcome | None = None


ChaseOutcome = Literal["chased", "not_accessible", "transient_failure", "no_target"]


@dataclass(frozen=True)
class ChaseResult:
    """The footage a chaser found, or why it found none.

    ``post`` is set exactly when ``outcome`` is ``"chased"``.
    """

    outcome: ChaseOutcome
    post: SourcePost | None = None
