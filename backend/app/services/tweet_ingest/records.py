"""Normalized acquire units: one tweet and one chased footage post.

``TweetRecord`` is what every acquire adapter produces (syndication for the
live entries, the archive reader for backfill) and what ``stitch`` consumes.
The unit is a normalized record, not a bare id, so the archive's inline reply
edges and media survive into the pipeline, which syndication cannot expose.
``ChasedPost`` is its off-thread twin: the footage post a chase resolved,
whichever technology served it, and ``ChaseResult`` is what a chaser answers
with, so a chase that resolved nothing still says why.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

# What a piece of media is. One name for the two the platform serves, read by
# the payload readers and by the media split.
MediaKind = Literal["image", "video"]

# The one type an imported photo is stored under, whatever the post served.
# Machine-fetched bytes go through a re-encode at ingest
# (``storage.prepare_media``, whose output format follows the declared type), so
# a PNG on X and a WebP in an export land as the one format the display
# derivatives already use: ``evidence_processing.DERIVATIVE_CONTENT_TYPE``, which
# ``test_ingest_media_types`` pins this against. No entry derives a photo's type
# from a payload field or a filename, so no entry can disagree about it.
PHOTO_CONTENT_TYPE = "image/jpeg"

# Videos are stored as fetched: no re-encode, and every payload reader picks an
# mp4 variant (``syndication.media_entry``), which is also what an export saved.
VIDEO_CONTENT_TYPE = "video/mp4"


@dataclass(frozen=True)
class ParsedMedia:
    """One image or video a post carries.

    ``remote_url`` is where the bytes are fetched from: a CDN URL on every live
    path, an archive-relative ``tweets_media/`` path on the export path.
    """

    kind: MediaKind
    remote_url: str
    # Where this media came from in the payload. The frontend's
    # primary-vs-proof split is by ``kind`` (videos = source footage,
    # images = annotated screenshots), so ``origin`` is informational only
    # (proof-body attribution, debugging, a future smarter split). Don't add
    # consumers that assume one origin maps to one bucket.
    origin: Literal["op", "quote"] = "op"

    @property
    def content_type(self) -> str:
        """The type this media is stored under, decided by ``kind`` alone.

        Derived, never carried: a photo is re-encoded to
        :data:`PHOTO_CONTENT_TYPE` at ingest and a video is stored as the mp4 it
        was fetched as, so there is nothing per-item left for a payload to
        declare and nothing for two entries to read differently.
        """
        return PHOTO_CONTENT_TYPE if self.kind == "image" else VIDEO_CONTENT_TYPE


@dataclass(frozen=True)
class QuotedTweet:
    """The tweet quoted by the OP, resolved to a full sub-record.

    In OSINT the analyst quote-tweets the footage and adds the coordinate, so
    the quoted tweet is usually the real source: its media is the footage and
    its ``created_at`` is the true source post time. Carried on the record so
    ``resolve_source`` / ``split_media`` attribute the source without a second
    fetch.
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
    media: list[ParsedMedia] = field(default_factory=list)
    # Reply edges — inline from an archive; from syndication the parent pointer
    # maps when the payload carries it (the chain itself still takes one fetch
    # per parent, the bot's walk). ``stitch`` unions on them.
    in_reply_to_status_id: str | None = None
    # The quoted tweet, resolved inline (syndication) or joined inside the
    # export (archive). The footage source in the common OSINT quote pattern.
    quoted: QuotedTweet | None = None
    # The id of the post this one quotes, whenever the payload declares one.
    # ``quoted`` is that post resolved; the two differ only where resolving it
    # takes a fetch (an export quoting a post the export does not hold), which
    # is the one target ``chase.chase_thread`` reads it for.
    quoted_status_id: str | None = None
    # A chased Telegram footage source (date + maybe media), parallel to
    # ``quoted``. Filled by ``chase.chase_thread`` when the thread's sole footage
    # link is a t.me post; ``None`` on every non-chasing path.
    telegram: TelegramFootage | None = None
    # The URLs the post links in its text (``entities.urls``).
    external_sources: list[SourceLink] = field(default_factory=list)
    # Why the chase of the target this record declared came back with no
    # footage, stamped by ``chase.chase_thread``. ``None`` on every record that
    # declared no target, and on the one whose chase succeeded, where the
    # footage itself is the answer. This is how the chase reports a failure it
    # swallowed to the resolution, which is pure and fetches nothing: a
    # ``transient_failure`` is the difference between "there is no footage" and
    # "we could not read it right now" (``resolve.SOURCE_FETCH_FAILED``).
    chase_outcome: ChaseOutcome | None = None


# What one chase came back with, whichever technology answered:
#
# * ``chased``: the footage post, on the result's ``post``;
# * ``not_accessible``: the upstream answered and there is nothing to take (the
#   post is gone, restricted, or its payload is one no chaser can read);
# * ``transient_failure``: the upstream throttled us or never answered, after
#   the retry schedule (``tweet_ingest.retry``) was spent on it;
# * ``no_target``: this chaser does not serve the target's host, so it fetched
#   nothing at all.
#
# Only ``transient_failure`` changes what the analyst is told: it is a detection to
# import again later rather than a source with no footage. The other three read
# the same way downstream, and are distinct so the class is named where it is
# known instead of being re-derived from an empty result.
ChaseOutcome = Literal["chased", "not_accessible", "transient_failure", "no_target"]


@dataclass(frozen=True)
class ChasedPost:
    """The footage post one chase resolved, whichever technology served it.

    The common return of every chaser under ``chase/``, so the one chase step
    asks for a target's footage without naming a technology.
    ``url`` is where the footage was found: the Telegram chaser echoes the
    target as the post wrote it, and the X chaser answers the canonical status
    URL it resolved (``urls.canonical_tweet_url``), since a status is stored
    under one spelling whichever one the analyst pasted. ``author``, ``text``
    and ``status_id`` are filled only where the technology models them: an X
    status carries all three, a Telegram post carries none, and
    ``chase.apply_chase`` reads ``status_id`` to pick the record slot the result
    belongs in.
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

    What every chaser under ``chase/`` returns, so a caller reads one answer
    whether the chase landed or not. ``post`` is set exactly when ``outcome`` is
    ``"chased"``; the three other outcomes carry no post and are the class of
    the failure (:data:`ChaseOutcome`).
    """

    outcome: ChaseOutcome
    post: ChasedPost | None = None
