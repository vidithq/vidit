"""The one brick: a thread of ``TweetRecord`` resolves to a ``ResolvedTweet``.

A "thread" is a list of ``TweetRecord`` (``stitch``'s output). ``resolve_thread``
is the single core both consumers run: the human ``parse`` path (a single-record
thread) and the machine ``detect`` path (a real self-thread) map its output into
their own shape, so they can't drift on coordinates, source, dates, or media.
``resolve_tweet(tweet_id)`` is the single-tweet convenience (fetch → resolve).

The small ``resolve_coords`` / ``resolve_source`` / ``split_media`` helpers are
the pieces; ``resolve_thread`` composes them plus the title / proof / date
derivations into the bundled ``ResolvedTweet``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime

import httpx

from .extract import ParsedCoord, clean_proof_text, derive_title, extract_coords
from .records import QuotedTweet, SourceLink, TweetRecord
from .syndication import ParsedMedia

# Stand-in for an unparseable timestamp on the NOT-NULL ``source_posted_at``: a
# visibly-wrong instant the owner corrects at submit, never a silent "now".
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

# External links whose target is footage (a tweet, a channel, a video), unlike a
# coordinate link (Google Maps) or an article. Their presence means the analyst
# is referencing someone else's footage, so the analyst's own media is
# annotation (proof), not the source.
_FOOTAGE_SOURCE_HOSTS = frozenset({"x", "telegram", "youtube"})


def _source_link(thread: list[TweetRecord]) -> SourceLink | None:
    """The first external link that points at footage (X / Telegram / YouTube)."""
    for record in thread:
        for link in record.external_sources:
            if link.host in _FOOTAGE_SOURCE_HOSTS:
                return link
    return None


def resolve_coords(thread: list[TweetRecord]) -> list[ParsedCoord]:
    """Coordinates from the thread's own text, falling back to any quoted tweet.

    Analyst commentary usually carries the coordinate, but some posts just say
    "here ↓" and let the quoted source carry it, so the quoted text is a
    thread-wide fallback only when the OP text yields nothing.
    """
    op_text = "\n".join(record.text for record in thread if record.text)
    coords = extract_coords(op_text)
    if coords:
        return coords
    quoted_text = "\n".join(
        record.quoted.text for record in thread if record.quoted is not None and record.quoted.text
    )
    return extract_coords(quoted_text) if quoted_text else []


def resolve_source(thread: list[TweetRecord]) -> tuple[str, str | None]:
    """The footage source URL and its post date (ISO 8601, or ``None``).

    Priority, matching how OSINT posts attribute a source:

    1. the first quoted tweet (the analyst quote-tweeted the footage, date known);
    2. the first external footage link (X status / Telegram / YouTube) the analyst
       put in the text as ``Source: <url>``;
    3. the thread head — a self-source tweet that carries its own footage.

    A coordinate link (Google Maps) or an article (host ``other``) is not a
    footage source and never wins the source slot.
    """
    for record in thread:
        if record.quoted is not None:
            quoted = record.quoted
            return (
                f"https://x.com/{quoted.handle}/status/{quoted.tweet_id}",
                quoted.created_at or None,
            )
    link = _source_link(thread)
    if link is not None:
        return link.url, None
    head = thread[0]
    return head.permalink, (head.created_at or None)


def split_media(thread: list[TweetRecord]) -> tuple[list[ParsedMedia], list[ParsedMedia]]:
    """``(source_media, proof_media)``.

    Footage (``source``) vs the analyst's annotation (``proof``):

    * a quoted tweet's media is the footage → source; the thread's own media is
      annotation → proof;
    * else if the analyst references an external footage source (a link to X /
      Telegram / YouTube), their own media is annotation → proof, and the source
      footage lives in the referenced tweet, absent here unless chased;
    * else the thread is self-source: its own media is the footage → source, with
      no separate proof.
    """
    quoted_media = [
        media for record in thread if record.quoted is not None for media in record.quoted.media
    ]
    own_media = [media for record in thread for media in record.media]
    if quoted_media:
        return quoted_media, own_media
    if _source_link(thread) is not None:
        return [], own_media
    return own_media, []


@dataclass(frozen=True)
class ResolvedTweet:
    """Everything a tweet / thread resolves to: the "tweet id → all info" object.

    ``parse`` and ``detect`` are thin mappers over this: nothing derived lives in
    either of them.
    """

    # Identity / provenance (from the thread head, the geoloc tweet).
    tweet_id: str
    detected_from_url: str
    owner_handle: str
    # Raw, carried for the mappers.
    text: str
    created_at: str  # the geoloc tweet's post time, ISO 8601 (raw)
    quoted: QuotedTweet | None
    external_sources: list[SourceLink]
    op_media: list[ParsedMedia]  # the thread's own media (op + quote origins)
    # Derived.
    coords: list[ParsedCoord]
    title: str
    proof_text: str
    source_url: str
    source_posted_at: datetime  # resolved source's date, NOT-NULL (epoch fallback)
    detected_post_at: datetime | None  # the geoloc tweet's date
    event_date: date
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)


def resolve_thread(thread: list[TweetRecord]) -> ResolvedTweet | None:
    """Resolve a stitched thread into a ``ResolvedTweet``. ``None`` for an empty
    thread; a coordinate-less thread still resolves (``coords == []``)."""
    if not thread:
        return None
    head = thread[0]
    own_text = "\n".join(record.text for record in thread if record.text)
    source_url, source_iso = resolve_source(thread)
    source_media, proof_media = split_media(thread)
    detected_post_at = _posted_at(head.created_at)
    source_posted_at = _posted_at(source_iso) if source_iso else None
    return ResolvedTweet(
        tweet_id=head.tweet_id,
        detected_from_url=head.permalink,
        owner_handle=head.handle,
        text=own_text,
        created_at=head.created_at,
        quoted=next((record.quoted for record in thread if record.quoted is not None), None),
        external_sources=[link for record in thread for link in record.external_sources],
        op_media=[media for record in thread for media in record.media],
        coords=resolve_coords(thread),
        title=derive_title(own_text),
        proof_text=clean_proof_text(own_text),
        source_url=source_url,
        # The resolved source's date, or the geoloc tweet's when the source is
        # off-platform / undatable (``source_posted_at`` is NOT NULL).
        source_posted_at=source_posted_at or detected_post_at or _EPOCH,
        detected_post_at=detected_post_at,
        event_date=_event_date(head.created_at, detected_post_at),
        source_media=source_media,
        proof_media=proof_media,
    )


def resolve_tweet(url: str, *, client: httpx.Client | None = None) -> ResolvedTweet | None:
    """The single-tweet entry: fetch ``url`` via syndication and resolve it.

    ``resolve_thread([record_from_syndication(url)])``. Used by the human import
    and the bot; the archive passes a stitched thread to ``resolve_thread``.
    """
    from .acquire import record_from_syndication

    return resolve_thread([record_from_syndication(url, client=client)])


def _posted_at(created_at: str) -> datetime | None:
    """Aware UTC datetime from an ISO 8601 timestamp, or None when it doesn't parse.

    Acquire adapters normalize ``created_at`` to ISO 8601. The caller maps None
    onto the ``source_posted_at`` epoch sentinel and a NULL ``detected_post_at``,
    and recovers ``event_date`` from the date prefix.
    """
    try:
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _event_date(created_at: str, posted_at: datetime | None) -> date:
    """The ``event_date``: the geoloc tweet's post date (a provisional proxy the
    owner corrects at submit).

    When the full timestamp parsed, its date. When only the time-of-day is
    malformed but the ``YYYY-MM-DD`` prefix is valid, recover the date so a
    garbled time doesn't discard it too. A fully unparseable value falls back to
    the epoch date.
    """
    if posted_at is not None:
        return posted_at.date()
    try:
        return date.fromisoformat(created_at[:10])
    except ValueError:
        return _EPOCH.date()
