"""The one brick: a thread of ``TweetRecord`` resolves to a ``ResolvedTweet``.

A "thread" is a list of ``TweetRecord``: ``stitch``'s output for the archive, or
the one hop ``acquire.acquire_thread`` reads for the bot and the paste.
``resolve_thread`` is the single core every entry runs, so the bot, the pasted
import and the archive backfill cannot drift on coordinates, source, dates, or
media. ``resolve_tweet(url)`` is the pasted-post convenience (acquire, then
resolve).

Every derived field follows one contract: filled only on an explicit signal in
the analyst's own text (a quote, a link, a coordinate), otherwise empty. No
deduction: no self-source fallback, no fabricated dates. The media split is the
one place a thread's own attachment moves without such a signal, and only a
video, and only into the source media slot: ``source_url`` is untouched, so a
promotion never reads as a declared source (see :func:`split_media`).

The small ``resolve_source`` / ``split_media`` helpers are the pieces;
``resolve_thread`` composes them plus the coordinate / title / proof / date
derivations into the bundled ``ResolvedTweet``.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from urllib.parse import parse_qsl, urlencode, urlparse

import httpx

from .extract import (
    ParsedCoord,
    clean_proof_text,
    derive_title,
    is_retweet,
    scan_coords,
    strip_bot_tag,
)
from .records import (
    QuotedTweet,
    TelegramFootage,
    TweetRecord,
    expand_shortlinks,
)
from .syndication import (
    _TELEGRAM_HOST_RE,
    _TWITTER_URL_HOST_RE,
    _X_STATUS_URL_RE,
    ParsedMedia,
    normalise_tweet_url,
)


def _hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def _x_status_id(url: str) -> str | None:
    """The X status id ``url`` names, or ``None`` when it names none.

    Host-gated on purpose: a non-X URL that merely carries
    ``x.com/<handle>/status/<id>`` inside its path, an archive.org capture being
    the common OSINT case, names no status of its own and must never be chased
    as one. ``_X_STATUS_URL_RE`` stays the single source of truth for the path
    shape.
    """
    if _TWITTER_URL_HOST_RE.match(_hostname(url)) is None:
        return None
    match = _X_STATUS_URL_RE.search(url)
    return match.group(1) if match is not None else None


def _status_link_handle(url: str) -> str | None:
    """The handle segment of an X status link, or ``None`` when ``url`` names no
    status or is the handle-less ``i/web/status`` form."""
    if _x_status_id(url) is None:
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

    A link to the analyst's own earlier post is a cross-reference, never a
    source: the source rule reads "the analyst points at someone else's
    footage", not at their own thread.
    """
    handle = _status_link_handle(url)
    return handle is not None and handle.lower() == owner_handle.lower()


def _is_non_status_x_link(url: str) -> bool:
    """Whether ``url`` points at X without naming a status (a profile, a search,
    a hashtag page).

    On X, footage lives at a status and nowhere else, so a link to a profile
    credits an author without pointing at anything a source slot can hold.
    """
    return _TWITTER_URL_HOST_RE.match(_hostname(url)) is not None and (
        _X_STATUS_URL_RE.search(url) is None
    )


_GOOGLE_HOST_RE = re.compile(r"^(?:www\.|maps\.)?google\.[a-z0-9.\-]+$", re.IGNORECASE)


def _is_coordinate_link(url: str) -> bool:
    """Whether ``url`` is a Google Maps link.

    A maps link is where the coordinate came from, not where the footage lives,
    and the coordinate extractors already read it (``extract._GMAPS_RE``). Both
    the ``maps.`` subdomain and a ``/maps`` path on a Google host count, plus the
    ``maps.app.goo.gl`` share form.
    """
    host = _hostname(url)
    if host == "maps.app.goo.gl":
        return True
    if _GOOGLE_HOST_RE.match(host) is None:
        return False
    return host.startswith("maps.") or urlparse(url).path.lower().startswith("/maps")


@dataclass(frozen=True)
class SourceCandidate:
    """A link the thread carries that a source slot may hold.

    ``status_id`` is the X status id when the link names one (the syndication
    chase key), ``None`` otherwise. ``telegram`` marks a ``t.me`` post (the
    embed chase key). Both name what may be *fetched*; neither decides what is
    stored.
    """

    url: str
    status_id: str | None = None
    telegram: bool = False


# Query parameters that carry share / campaign provenance rather than the
# target's identity: two links differing only in these point at one target.
_TRACKING_QUERY_PARAMS = frozenset(
    {"s", "si", "t", "feature", "ref", "ref_src", "ref_url", "fbclid", "gclid", "igshid"}
)


def _identifying_query(query: str) -> str:
    """``query`` with the tracking parameters dropped and the rest sorted, so one
    target spelled with different share provenance yields one string."""
    kept = sorted(
        (name, value)
        for name, value in parse_qsl(query, keep_blank_values=True)
        if name.lower() not in _TRACKING_QUERY_PARAMS and not name.lower().startswith("utm_")
    )
    return urlencode(kept)


def link_identity(url: str) -> str:
    """The identity two spellings of one link share, the one dedup rule.

    An X status keys on its status id, so ``x.com`` / ``twitter.com``, query and
    trailing-slash variants of one status are one link. Every other host keys on
    host plus path plus the *identifying* query (:func:`_identifying_query`): a
    video id usually lives in the query, so ``watch?v=AAA`` and ``watch?v=BBB``
    are two links, while ``watch?v=AAA&si=…`` is one link shared twice.
    """
    status_id = _x_status_id(url)
    if status_id is not None:
        return f"x:{status_id}"
    parsed = urlparse(url)
    base = f"{_hostname(url)}{parsed.path.rstrip('/')}"
    query = _identifying_query(parsed.query)
    return f"{base}?{query}" if query else base


def source_candidates(urls: Iterable[str], *, owner_handle: str) -> list[SourceCandidate]:
    """The deduplicated source candidates among ``urls``, in order.

    Host-blind: every link the thread carries is a candidate unless it is one of
    the three exclusions, which are exclusions because they point at no footage
    at all rather than because of what platform they name:

    * a status link back to ``owner_handle``'s own post (a cross-reference);
    * an X link naming no status (a profile, a search);
    * a Google Maps link (a coordinate).

    So a TikTok, an Instagram post or a news article is a candidate exactly like
    an X status is. Duplicates collapse on :func:`link_identity`.
    """
    candidates: list[SourceCandidate] = []
    seen: set[str] = set()
    for url in urls:
        if _is_own_status_link(url, owner_handle) or _is_non_status_x_link(url):
            continue
        if _is_coordinate_link(url):
            continue
        key = link_identity(url)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            SourceCandidate(
                url=url,
                status_id=_x_status_id(url),
                telegram=_TELEGRAM_HOST_RE.match(_hostname(url)) is not None,
            )
        )
    return candidates


def thread_candidates(thread: list[TweetRecord]) -> list[SourceCandidate]:
    """The thread's source candidates (:func:`source_candidates` over every
    record's links, under the thread head's handle)."""
    return source_candidates(
        [link.url for record in thread for link in record.external_sources],
        owner_handle=thread[0].handle if thread else "",
    )


def _sole_candidate(thread: list[TweetRecord]) -> SourceCandidate | None:
    """The thread's one source candidate, or ``None`` when it has none or
    several.

    Several candidates are ambiguous: the slot stays empty and every candidate
    lands in the secondary links for the analyst to promote one at review.
    """
    candidates = thread_candidates(thread)
    return candidates[0] if len(candidates) == 1 else None


def resolve_secondary_sources(thread: list[TweetRecord], source_url: str | None) -> list[str]:
    """The mirrors: the source candidates the slot did not take.

    The candidate whose identity matches the resolved ``source_url`` is the
    primary in another spelling and is excluded. When the source was ambiguous
    (several candidates, so the slot stayed empty) every candidate lands here.
    Blanks and the write-path cap are the shared normalizer's job.
    """
    primary = link_identity(source_url) if source_url else None
    urls = [
        candidate.url
        for candidate in thread_candidates(thread)
        if link_identity(candidate.url) != primary
    ]
    # Imported locally so the rest of ``tweet_ingest`` stays importable without
    # the app's service layer.
    from app.services.events import truncate_secondary_source_urls

    return truncate_secondary_source_urls(urls, source_url)


def _telegram_footage(thread: list[TweetRecord], link: SourceCandidate) -> TelegramFootage | None:
    """The chased Telegram embed backing the resolved source ``link``, or ``None``.

    Only when the resolved link is a Telegram post whose embed was chased onto
    some record (matched by URL). ``None`` for any other link or when the chase
    found nothing, so the source degrades to link-only (url, no date, no media).
    Callers reach this only after the quote branch has been ruled out, so a
    quote always takes precedence over a link.
    """
    if not link.telegram:
        return None
    return next(
        (
            record.telegram
            for record in thread
            if record.telegram is not None and record.telegram.url == link.url
        ),
        None,
    )


def resolve_source(thread: list[TweetRecord]) -> tuple[str | None, str | None]:
    """The source URL and its post date (ISO 8601), either may be ``None``.

    A quote outranks links: the analyst quote-tweeted the footage, so the quoted
    tweet is the source and its date comes free. That includes a status the
    acquisition chased into the quote slot on the analyst's behalf. Failing a
    quote, the thread's one source candidate is the source
    (:func:`_sole_candidate`); a Telegram post whose embed was chased carries
    its date, every other link is stored link-only.

    No other signal counts. A thread that neither quotes nor links anything has
    declared no source, so both halves are ``None``; the thread head's permalink
    is provenance (``detected_from_url``), never the source.
    """
    for record in thread:
        if record.quoted is not None:
            quoted = record.quoted
            return (
                f"https://x.com/{quoted.handle}/status/{quoted.tweet_id}",
                quoted.created_at or None,
            )
    link = _sole_candidate(thread)
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
    instead (a sensitive post serves none, leaving the slot empty).

    With the source slot still empty after both, the thread's first own video
    fills it and leaves the proof: a video an analyst attaches is the footage
    itself, and the proof document embeds images only, so leaving it in the
    annotation slot drops it entirely. Photos are never promoted (an analyst's
    photo is a map crop, a screenshot, an annotated frame), and a quote keeps
    absolute precedence even when it carried no media at all.
    """
    own_media = [media for record in thread for media in record.media]
    if any(record.quoted is not None for record in thread):
        # A quote takes precedence as the source (even when it carried no media),
        # so its media is the only footage; a Telegram link is never consulted.
        quoted_media = [
            media for record in thread if record.quoted is not None for media in record.quoted.media
        ]
        return quoted_media, own_media
    link = _sole_candidate(thread)
    if link is not None:
        footage = _telegram_footage(thread, link)
        if footage is not None:
            return list(footage.media), own_media
    video = next((i for i, media in enumerate(own_media) if media.kind == "video"), None)
    if video is None:
        return [], own_media
    return [own_media[video]], own_media[:video] + own_media[video + 1 :]


@dataclass(frozen=True)
class ResolvedTweet:
    """Everything a tweet / thread resolves to: the "tweet id → all info" object.

    ``parse`` and ``detect`` are thin mappers over this: nothing derived lives in
    either of them.
    """

    # Identity / provenance (from the thread head, the geoloc tweet).
    detected_from_url: str
    owner_handle: str
    # The thread's own text with each entity's ``t.co`` wrapper expanded back to
    # the real URL, carried for the mappers.
    text: str
    created_at: str  # the geoloc tweet's post time, ISO 8601 (raw)
    quoted: QuotedTweet | None
    op_media: list[ParsedMedia]  # the thread's own media (op + quote origins)
    # Derived.
    coords: list[ParsedCoord]
    # A coordinate-shaped string was read and dropped for sitting outside the
    # world; the only coordinate refusal an entry can name apart from "none".
    coords_out_of_bounds: bool
    title: str
    proof_text: str
    # The source; None when the thread neither quotes nor carries exactly one
    # candidate link (no self-source deduction).
    source_url: str | None
    # The source's post instant, only when actually known (a dated quote or a
    # chased Telegram embed); never a fallback onto the geoloc tweet's own date.
    source_posted_at: datetime | None
    detected_post_at: datetime | None  # the geoloc tweet's date
    # Provisional proxy from the geoloc tweet's post date; None when the
    # timestamp is unusable (no epoch fabrication).
    event_date: date | None
    # The mirrors: the candidates the source slot didn't take, normalized and
    # capped (:func:`resolve_secondary_sources`).
    secondary_source_urls: list[str] = field(default_factory=list)
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)


def own_posts(thread: list[TweetRecord]) -> list[TweetRecord]:
    """``thread`` without the retweets: posts carrying someone else's words.

    A retweet's content belongs to another account, so importing one would file
    a stranger's geolocation under the analyst. The rule holds on every entry
    (:func:`extract.is_retweet`); the archive reader also drops them earlier, so
    they never enter its stitching.
    """
    return [record for record in thread if not is_retweet(record.text)]


def resolve_thread(thread: list[TweetRecord]) -> ResolvedTweet | None:
    """Resolve a stitched thread into a ``ResolvedTweet``. ``None`` for an empty
    thread or one carrying only retweets; a coordinate-less thread still
    resolves (``coords == []``)."""
    posts = own_posts(thread)
    if not posts:
        return None
    head = posts[0]
    # Expanded per record before the join: raw tweet text carries only opaque
    # ``t.co`` wrappers, so an analyst's reference link would otherwise reach the
    # proof unreadable. The bot tag is addressing rather than content, so it
    # goes; everything else the analyst wrote stays, the coordinate line
    # included. Imported locally, like the two service-layer helpers below, so
    # the rest of ``tweet_ingest`` stays importable on its own.
    from app.config import settings

    joined = "\n".join(
        expand_shortlinks(record.text, record.external_sources) for record in posts if record.text
    )
    own_text = strip_bot_tag(joined, settings.x_bot_handle)
    # A coordinate counts only in the analyst's own text: one that lives solely
    # in a third party's quoted post is that party's geolocation.
    scan = scan_coords(own_text)
    source_url, source_iso = resolve_source(posts)
    source_media, proof_media = split_media(posts)
    detected_post_at = _posted_at(head.created_at)
    source_posted_at = _posted_at(source_iso) if source_iso else None
    return ResolvedTweet(
        detected_from_url=head.permalink,
        owner_handle=head.handle,
        text=own_text,
        created_at=head.created_at,
        quoted=next((record.quoted for record in posts if record.quoted is not None), None),
        op_media=[media for record in posts for media in record.media],
        coords=scan.coords,
        coords_out_of_bounds=scan.out_of_bounds,
        title=derive_title(own_text),
        proof_text=clean_proof_text(own_text),
        source_url=source_url,
        source_posted_at=source_posted_at,
        detected_post_at=detected_post_at,
        event_date=_event_date(head.created_at, detected_post_at),
        secondary_source_urls=resolve_secondary_sources(posts, source_url),
        source_media=source_media,
        proof_media=proof_media,
    )


def resolve_tweet(url: str, *, client: httpx.Client | None = None) -> ResolvedTweet | None:
    """The pasted-tweet entry: acquire the post at ``url`` and resolve it.

    ``resolve_thread`` over :func:`acquire.acquire_thread`, so the paste reads
    the same one hop the bot reads: a coordinate in a post and a source link in
    its author's own reply resolve together, whichever of the two was pasted.
    The archive passes its own stitched thread to ``resolve_thread`` instead.
    """
    from .acquire import acquire_thread

    normalised = normalise_tweet_url(url)
    acquired = acquire_thread(normalised.tweet_id, handle=normalised.handle, client=client)
    return resolve_thread(acquired.records)


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
