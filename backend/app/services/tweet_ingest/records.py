"""Normalized acquire units: one tweet and one chased footage post.

``TweetRecord`` is what every acquire adapter produces and ``stitch`` consumes.
``ChasedPost`` is the footage post a chase resolved, and ``ChaseResult`` is a
chaser's answer, which says why when nothing resolved.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

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
class QuotedTweet:
    """The tweet quoted by the OP, resolved to a full sub-record.

    Analysts quote-tweet the footage, so this is usually the real source: its
    media is the footage and its ``created_at`` the source post time.
    """

    tweet_id: str
    handle: str
    text: str
    created_at: str  # ISO 8601 UTC
    media: list[ParsedMedia] = field(default_factory=list)
    # Read only by the request branch's coordinate scan (raw text holds opaque
    # ``t.co`` wrappers). Never a source candidate (:func:`resolve.thread_candidates`).
    external_sources: list[SourceLink] = field(default_factory=list)


@dataclass(frozen=True)
class TelegramFootage:
    """An off-platform Telegram footage source, chased from its public embed.

    Not a ``QuotedTweet``: a t.me post has only a date and, when served, media.
    ``url`` must equal the resolved ``SourceLink.url`` for the resolution to
    pick this footage up.
    """

    url: str
    posted_at: str | None  # ISO 8601 UTC, None when the embed omitted the date
    media: list[ParsedMedia] = field(default_factory=list)


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
    quoted: QuotedTweet | None = None
    # The quoted post's id, when declared. Differs from ``quoted`` only where
    # resolving it takes a fetch (``chase.chase_thread`` reads it).
    quoted_status_id: str | None = None
    # Filled by ``chase.chase_thread`` when the sole footage link is a t.me post.
    telegram: TelegramFootage | None = None
    # The URLs the post links in its text (``entities.urls``).
    external_sources: list[SourceLink] = field(default_factory=list)
    # Why the chase found no footage, stamped by ``chase.chase_thread``; ``None``
    # when no target was declared or the chase succeeded. This carries a swallowed
    # failure to the pure resolution: ``transient_failure`` means "could not read
    # it right now", not "no footage" (``resolve.SOURCE_FETCH_FAILED``).
    chase_outcome: ChaseOutcome | None = None


# What one chase came back with:
#
# * ``chased``: the footage post, on the result's ``post``;
# * ``not_accessible``: answered, nothing to take (gone, restricted, unreadable);
# * ``transient_failure``: throttled or unanswered after the retry schedule
#   (``tweet_ingest.retry``);
# * ``no_target``: this chaser does not serve the host, so nothing was fetched.
#
# Only ``transient_failure`` changes what the analyst is told (import again
# later, not "no footage").
ChaseOutcome = Literal["chased", "not_accessible", "transient_failure", "no_target"]


@dataclass(frozen=True)
class ChasedPost:
    """The footage post one chase resolved, whichever chaser served it.

    ``url`` is the target as written for Telegram, and the canonical status URL
    for X (``urls.canonical_tweet_url``). ``author``, ``text`` and ``status_id``
    are set only for X; ``chase.apply_chase`` reads ``status_id`` to pick the
    record slot.
    """

    url: str
    posted_at: str | None = None  # ISO 8601 UTC, None when the post serves none
    media: list[ParsedMedia] = field(default_factory=list)
    author: str | None = None
    text: str = ""
    status_id: str | None = None


@dataclass(frozen=True)
class ChaseResult:
    """The footage a chaser found, or why it found none.

    ``post`` is set exactly when ``outcome`` is ``"chased"``.
    """

    outcome: ChaseOutcome
    post: ChasedPost | None = None
