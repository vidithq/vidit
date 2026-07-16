"""The one brick: a thread of ``TweetRecord`` resolves to a ``ResolvedTweet``.

A "thread" is a list of ``TweetRecord`` (``stitch``'s output). ``resolve_thread``
is the single core both consumers run: the human ``parse`` path (a single-record
thread) and the machine ``detect`` path (a real self-thread) map its output into
their own shape, so they can't drift on coordinates, source, dates, or media.
``resolve_tweet(tweet_id)`` is the single-tweet convenience (fetch, then resolve).

Every derived field follows one contract: filled only on an explicit signal in
the tweet (a quote, a footage link, a coordinate), otherwise empty. No
deduction: no self-source fallback, no fabricated dates.

The small ``resolve_coords`` / ``resolve_source`` / ``split_media`` helpers are
the pieces; ``resolve_thread`` composes them plus the title / proof / date
derivations into the bundled ``ResolvedTweet``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from urllib.parse import urlparse

import httpx

from .extract import ParsedCoord, clean_proof_text, derive_title, extract_coords
from .records import QuotedTweet, SourceLink, TelegramFootage, TweetRecord
from .syndication import _X_STATUS_URL_RE, ParsedMedia

# External links whose target is footage (a tweet, a channel, a video), unlike a
# coordinate link (Google Maps) or an article. Their presence means the analyst
# is referencing someone else's footage, so the analyst's own media is
# annotation (proof), not the source.
_FOOTAGE_SOURCE_HOSTS = frozenset({"x", "telegram", "youtube"})


def _status_link_handle(url: str) -> str | None:
    """The handle segment of an X status link, or ``None`` when ``url`` isn't
    a status link (``_X_STATUS_URL_RE`` doesn't match) or is the handle-less
    ``i/web/status`` form.

    Reuses ``_X_STATUS_URL_RE``, the single source of truth for "this X link is
    a status" (also used by ``classify_source_host`` and the archive chase),
    then reads the handle straight off the URL path.
    """
    if _X_STATUS_URL_RE.search(url) is None:
        return None
    try:
        parts = [p for p in urlparse(url).path.split("/") if p]
    except ValueError:
        return None
    if len(parts) >= 3 and parts[1] == "status":
        return parts[0]
    return None


def _is_own_status_link(url: str, owner_handle: str) -> bool:
    """Whether ``url`` is a status link back to ``owner_handle``'s own post.

    A link to the analyst's own earlier post is a cross-reference, never
    third-party footage: the OSINT convention this brick reads for a source is
    "the analyst points at someone else's footage", not their own thread.
    """
    handle = _status_link_handle(url)
    return handle is not None and handle.lower() == owner_handle.lower()


@dataclass(frozen=True)
class FootageCandidate:
    """A deduplicated footage-source candidate: the link, its host class, and,
    for an X status, the extracted status id (the archive chase key)."""

    url: str
    host: str
    status_id: str | None


def _footage_dedup_key(url: str, host: str, status_id: str | None) -> str:
    """The identity two footage links share, so duplicates collapse to one
    candidate.

    An X status keys on the status id, so ``x.com`` / ``twitter.com`` (or
    query / trailing-slash) variants of one status are one candidate; other
    hosts key on host plus path with the query and any trailing slash stripped.
    """
    if status_id is not None:
        return f"x:{status_id}"
    parsed = urlparse(url)
    return f"{host}:{(parsed.hostname or '').lower()}{parsed.path.rstrip('/')}"


def footage_candidates(
    links: Iterable[tuple[str, str]], *, owner_handle: str
) -> list[FootageCandidate]:
    """The deduplicated footage candidates among host-classified source links.

    The single source of truth both the shared resolution (:func:`_source_link`)
    and the archive chase run, so "which link is the footage source" cannot drift
    between them. A link is a candidate when its host is footage
    (X status / Telegram / YouTube); an X status back to ``owner_handle``'s own
    post is a cross-reference, not footage, and is dropped first (only the X host
    carries a handle to compare). Duplicates collapse per :func:`_footage_dedup_key`.
    """
    candidates: list[FootageCandidate] = []
    seen: set[str] = set()
    for url, host in links:
        if host not in _FOOTAGE_SOURCE_HOSTS:
            continue
        status_id: str | None = None
        if host == "x":
            if _is_own_status_link(url, owner_handle):
                continue
            match = _X_STATUS_URL_RE.search(url)
            status_id = match.group(1) if match is not None else None
        key = _footage_dedup_key(url, host, status_id)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(FootageCandidate(url=url, host=host, status_id=status_id))
    return candidates


def _source_link(thread: list[TweetRecord]) -> FootageCandidate | None:
    """The only external link that points at footage (X / Telegram / YouTube),
    or ``None`` when there is none or several.

    Decided by :func:`footage_candidates` (the shared rule): a sole candidate is
    the declared source; several distinct candidates are ambiguous, so no link is
    picked and the source stays empty for review.
    """
    owner_handle = thread[0].handle if thread else ""
    links = [(link.url, link.host) for record in thread for link in record.external_sources]
    candidates = footage_candidates(links, owner_handle=owner_handle)
    return candidates[0] if len(candidates) == 1 else None


def _telegram_footage(thread: list[TweetRecord], link: FootageCandidate) -> TelegramFootage | None:
    """The chased Telegram embed backing the resolved footage ``link``, or ``None``.

    Only when the resolved source link is a Telegram post whose embed was chased
    onto some record (matched by URL). ``None`` for any non-Telegram link or when
    the chase did not run / found nothing, so the source degrades to link-only
    (url, no date, no media). Callers reach this only after the quote branch has
    been ruled out, so a quote always takes precedence over a link.
    """
    if link.host != "telegram":
        return None
    return next(
        (
            record.telegram
            for record in thread
            if record.telegram is not None and record.telegram.url == link.url
        ),
        None,
    )


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


def resolve_source(thread: list[TweetRecord]) -> tuple[str | None, str | None]:
    """The footage source URL and its post date (ISO 8601), either may be ``None``.

    Priority, matching how OSINT posts attribute a source:

    1. the first quoted tweet (the analyst quote-tweeted the footage, date known);
    2. the sole external footage link (X status / Telegram / YouTube) the analyst
       put in the text as ``Source: <url>`` (date unknown); several distinct
       footage links are ambiguous and fill nothing (see :func:`_source_link`).

    A Telegram footage link whose public embed was chased (archive path) carries
    the post date, so the second case fills the date from that embed instead of
    leaving it ``None``.

    No other signal counts. A thread that neither quotes nor links footage has
    declared no source, so both halves are ``None``; the thread head's permalink
    is provenance (``detected_from_url``), never the source. A coordinate link
    (Google Maps) or an article (host ``other``) is not a footage source either.
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
        footage = _telegram_footage(thread, link)
        return link.url, (footage.posted_at if footage is not None else None)
    return None, None


def split_media(thread: list[TweetRecord]) -> tuple[list[ParsedMedia], list[ParsedMedia]]:
    """``(source_media, proof_media)``.

    Footage (``source``) vs the analyst's annotation (``proof``): a quoted
    tweet's media is the footage, so it is the only media that lands in the
    source slot. When there is no quote but the resolved source is a chased
    Telegram post whose embed served footage, that footage is the source media
    instead (a sensitive post serves none, leaving the slot empty). The thread's
    own media is always annotation (proof), even when the thread declares no
    source at all: without an explicit signal the brick never promotes the
    analyst's own attachment to footage.
    """
    own_media = [media for record in thread for media in record.media]
    if any(record.quoted is not None for record in thread):
        # A quote takes precedence as the source (even when it carried no media),
        # so its media is the only footage; a Telegram link is never consulted.
        quoted_media = [
            media for record in thread if record.quoted is not None for media in record.quoted.media
        ]
        return quoted_media, own_media
    link = _source_link(thread)
    if link is not None:
        footage = _telegram_footage(thread, link)
        if footage is not None:
            return list(footage.media), own_media
    return [], own_media


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
    # The declared footage source; None when the thread neither quotes nor
    # links footage (no self-source deduction).
    source_url: str | None
    # The source's post instant, only when actually known (a dated quote);
    # never a fallback onto the geoloc tweet's own date.
    source_posted_at: datetime | None
    detected_post_at: datetime | None  # the geoloc tweet's date
    # Provisional proxy from the geoloc tweet's post date; None when the
    # timestamp is unusable (no epoch fabrication).
    event_date: date | None
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
        source_posted_at=source_posted_at,
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

    Acquire adapters normalize ``created_at`` to ISO 8601. A None maps onto a
    NULL ``detected_post_at``; ``_event_date`` still recovers the date prefix.
    """
    try:
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _event_date(created_at: str, posted_at: datetime | None) -> date | None:
    """The ``event_date``: the geoloc tweet's post date (a provisional proxy the
    owner corrects at submit).

    When the full timestamp parsed, its date. When only the time-of-day is
    malformed but the ``YYYY-MM-DD`` prefix is valid, recover the date so a
    garbled time doesn't discard it too. A fully unparseable value yields None:
    an unknown date stays unknown, never a fabricated epoch.
    """
    if posted_at is not None:
        return posted_at.date()
    try:
        return date.fromisoformat(created_at[:10])
    except ValueError:
        return None
