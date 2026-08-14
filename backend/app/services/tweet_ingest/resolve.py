"""The one brick: a thread of ``TweetRecord`` resolves to a ``ResolvedTweet``.

A "thread" is a list of ``TweetRecord`` (``stitch``'s output). ``resolve_thread``
is the single core both consumers run: the human ``parse`` path (a single-record
thread) and the machine ``detect`` path (a real self-thread) map its output into
their own shape, so they can't drift on coordinates, source, dates, or media.
``resolve_tweet(tweet_id)`` is the single-tweet convenience (fetch, then resolve).

Every derived field follows one contract: filled only on an explicit signal in
the tweet (a quote, a footage link, a coordinate), otherwise empty. No
deduction: no self-source fallback, no fabricated dates. The media split is the
one place a thread's own attachment moves without such a signal, and only a
video, and only into the source media slot: ``source_url`` is untouched, so a
promotion never reads as a declared source (see :func:`split_media`).

The small ``resolve_coords`` / ``resolve_source`` / ``split_media`` helpers are
the pieces; ``resolve_thread`` composes them plus the title / proof / date
derivations into the bundled ``ResolvedTweet``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from urllib.parse import parse_qsl, urlencode, urlparse

import httpx

from .extract import ParsedCoord, clean_proof_text, derive_title, extract_coords
from .records import (
    QuotedTweet,
    SourceLink,
    TelegramFootage,
    TweetRecord,
    bound_link,
    expand_shortlinks,
    written_tokens,
)
from .syndication import _TWITTER_URL_HOST_RE, _X_STATUS_URL_RE, ParsedMedia

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

    Collapsing the query is the right call for picking ONE source (a lone
    YouTube path spelled several ways must not read as ambiguous) and the wrong
    one for listing mirrors, where ``watch?v=`` carries the video identity;
    :func:`_mirror_dedup_key` is that stricter key.
    """
    if status_id is not None:
        return f"x:{status_id}"
    parsed = urlparse(url)
    return f"{host}:{(parsed.hostname or '').lower()}{parsed.path.rstrip('/')}"


# Query parameters that carry share / campaign provenance rather than the
# target's identity: two links differing only in these point at one video.
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


def _mirror_dedup_key(url: str, host: str, status_id: str | None) -> str:
    """The identity two footage links share when the question is "are these the
    same mirror", stricter than :func:`_footage_dedup_key`.

    An X status still keys on the status id (the path carries the identity, the
    query never does). Every other host keys on host plus path plus the
    *identifying* query (:func:`_identifying_query`): on the sanctioned footage
    hosts the video id lives in the query, so ``watch?v=AAA`` and ``watch?v=BBB``
    are two videos, while ``watch?v=AAA&si=...`` is one video shared twice.
    """
    if status_id is not None:
        return f"x:{status_id}"
    parsed = urlparse(url)
    base = f"{host}:{(parsed.hostname or '').lower()}{parsed.path.rstrip('/')}"
    query = _identifying_query(parsed.query)
    return f"{base}?{query}" if query else base


def footage_candidates(
    links: Iterable[tuple[str, str]],
    *,
    owner_handle: str,
    dedup_key: Callable[[str, str, str | None], str] = _footage_dedup_key,
) -> list[FootageCandidate]:
    """The deduplicated footage candidates among host-classified source links.

    The single source of truth both the shared resolution (:func:`_source_link`)
    and the archive chase run, so "which link is the footage source" cannot drift
    between them. A link is a candidate when its host is footage
    (X status / Telegram / YouTube); an X status back to ``owner_handle``'s own
    post is a cross-reference, not footage, and is dropped first (only the X host
    carries a handle to compare). Duplicates collapse per ``dedup_key``, the
    source slot's :func:`_footage_dedup_key` by default; the mirror list passes
    :func:`_mirror_dedup_key` so two videos sharing a path stay two candidates.
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
        key = dedup_key(url, host, status_id)
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


def _mirror_identity(url: str) -> str:
    """The identity two spellings of one mirror share, via :func:`_mirror_dedup_key`.

    Used to compare arbitrary links (the primary source against the thread's
    other links) where no host classification is in hand: the host prefix is
    left empty, which is harmless because both sides of every comparison come
    through here. The X-status collapse still applies, so ``x.com`` /
    ``twitter.com`` / query variants of one status compare equal, and so does
    the tracking-parameter strip, so ``?si=`` / ``?utm_source=`` spellings of one
    video compare equal too.
    """
    match = _X_STATUS_URL_RE.search(url)
    return _mirror_dedup_key(url, "", match.group(1) if match is not None else None)


# The OSINT convention for naming the footage source explicitly: a line that is
# nothing but ``Source:`` and URL tokens. Whole-line, like the bot's bare shape:
# a link inside prose is a proof reference, never a designation, and a line
# carrying any non-URL word after the label does not match at all.
#
# The line is read as several tokens rather than one because X appends the
# wrapper of the post's OWN attached media to the end of the text, so an
# analyst's one-token line reaches storage as two tokens. Those wrappers are
# dropped by name (``records.written_tokens``); what the analyst wrote must
# still come to exactly one token, so two genuine links stay ambiguous and
# designate nothing.
_SOURCE_LINE_RE = re.compile(
    r"^\s*source\s*:\s*(https?://\S+(?:\s+https?://\S+)*)\s*$", re.IGNORECASE
)


def _is_non_status_x_link(url: str) -> bool:
    """Whether ``url`` points at X without naming a status (a profile, a search,
    a hashtag page).

    On X, footage lives at a status and nowhere else, which is why
    ``classify_source_host`` demotes every other X path to host ``other``. The
    designation reads that as a hard rule rather than a classification, so
    writing ``Source: x.com/<handle>`` credits an author without filling the
    footage slot with a link that points at no footage.
    """
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return _TWITTER_URL_HOST_RE.match(host) is not None and _X_STATUS_URL_RE.search(url) is None


def _as_candidate(link: SourceLink) -> FootageCandidate:
    """``link`` as a footage candidate, whatever its host.

    :func:`footage_candidates` answers "does this link classify as footage";
    an explicit designation has already answered that, so this only carries the
    X status id across for the chase.
    """
    match = _X_STATUS_URL_RE.search(link.url)
    return FootageCandidate(
        url=link.url, host=link.host, status_id=match.group(1) if match is not None else None
    )


def designated_source(
    text: str,
    links: Iterable[SourceLink],
    *,
    owner_handle: str,
    media_shortlinks: Iterable[str] = (),
) -> FootageCandidate | None:
    """The footage source a ``Source: <url>`` line designates, or ``None``.

    The explicit half of the source contract: a designation is host-blind off
    X, since the chase vocabulary (X status via syndication, Telegram via embed)
    decides what gets fetched, never what gets stored. So an Instagram / TikTok /
    article link fills ``source_url`` link-only, with no date and no media.

    ``media_shortlinks`` are the post's own attached-media wrappers
    (``syndication.extract_media_shortlinks``): X appends them to the text, so
    they sit on whatever line ends the post, designation lines included. They
    are dropped from the line's tokens (:func:`written_tokens`) before the count,
    which is what lets the whole-line rule read the line as the analyst wrote it.
    What is left must be exactly one token: a line naming two genuine links is
    ambiguous and designates nothing.

    The token must bind to one of ``links`` (:func:`bound_link`), which is what
    keeps a link the analyst only wrote about out of the slot. Two links are
    refused whatever the line says: an X link that names no status
    (:func:`_is_non_status_x_link`) and a status link back to ``owner_handle``'s
    own post (a cross-reference, not footage). Both fall through to the
    sole-candidate rule instead. Several ``Source:`` lines naming different
    links are ambiguous and designate nothing; the same link named twice is one
    designation.
    """
    entries = list(links)
    own_media = list(media_shortlinks)
    designated: FootageCandidate | None = None
    for line in text.splitlines():
        match = _SOURCE_LINE_RE.match(line)
        if match is None:
            continue
        tokens = written_tokens(match.group(1).split(), own_media)
        if len(tokens) != 1:
            continue
        link = bound_link(tokens[0], entries)
        if link is None or _is_non_status_x_link(link.url):
            continue
        if _is_own_status_link(link.url, owner_handle):
            continue
        if designated is not None:
            if _mirror_identity(designated.url) != _mirror_identity(link.url):
                return None
            continue
        designated = _as_candidate(link)
    return designated


def _declared_footage(thread: list[TweetRecord]) -> FootageCandidate | None:
    """The thread's footage link: the explicit ``Source:`` designation
    (:func:`designated_source`) when it has one, else the sole footage candidate
    (:func:`_source_link`).

    One home for "which link is the footage" across the source URL, the source
    date, and the media split, so the three cannot disagree. The whole thread is
    read at once, so two records naming different links read as the ambiguity
    they are and the sole-candidate rule decides instead; the own-media wrappers
    are pooled the same way, since the text is.
    """
    designated = designated_source(
        "\n".join(record.text for record in thread),
        [link for record in thread for link in record.external_sources],
        owner_handle=thread[0].handle if thread else "",
        media_shortlinks=[token for record in thread for token in record.media_shortlinks],
    )
    return designated if designated is not None else _source_link(thread)


def resolve_secondary_sources(thread: list[TweetRecord], source_url: str | None) -> list[str]:
    """The mirrors: the footage links the source slot did not take.

    Secondary source links are the same footage posted elsewhere, so which links
    qualify is :func:`footage_candidates`, the same rule that picks the primary:
    one home for "which link points at footage", and the own-status
    cross-reference skip comes with it. A bare profile link or a coordinate link
    classifies as host ``other`` and is not a mirror any more than it is a
    source, so it stays out.

    What differs is the identity two links share, because a list asks a stricter
    question than a slot. Mirrors key on :func:`_mirror_dedup_key`: an X status
    on its status id, every other host on host plus path plus the query minus
    tracking parameters. So two YouTube ``watch?v=`` ids on one path are two
    mirrors, while ``?si=`` / ``?utm_source=`` spellings of one video are one.
    The source slot's own key collapses the whole query, which is right for
    picking one link and would silently swallow the second video here.

    :func:`resolve_source` keeps at most one candidate and drops the rest; those
    land here in order instead. The candidate whose mirror identity matches the
    resolved ``source_url`` is the primary in another spelling and is excluded.
    When the source was ambiguous (several candidates, so the slot stayed empty)
    every candidate lands here for the owner to promote one at submit. Blanks
    and the cap are the shared normalizer's job.
    """
    owner_handle = thread[0].handle if thread else ""
    links = [(link.url, link.host) for record in thread for link in record.external_sources]
    primary = _mirror_identity(source_url) if source_url else None
    urls = [
        candidate.url
        for candidate in footage_candidates(
            links, owner_handle=owner_handle, dedup_key=_mirror_dedup_key
        )
        if _mirror_identity(candidate.url) != primary
    ]
    # Imported locally so the rest of ``tweet_ingest`` stays importable without
    # the app's service layer, same as ``detect``'s coordinate-bounds check.
    from app.services.events import truncate_secondary_source_urls

    return truncate_secondary_source_urls(urls, source_url)


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
    2. the link an explicit ``Source: <url>`` line designates, whatever its host
       (:func:`designated_source`), stored link-only when the chase vocabulary
       cannot fetch it;
    3. the sole external footage link (X status / Telegram / YouTube) elsewhere
       in the text (date unknown); several distinct footage links are ambiguous
       and fill nothing (see :func:`_source_link`).

    A Telegram footage link whose public embed was chased (archive path) carries
    the post date, so the link cases fill the date from that embed instead of
    leaving it ``None``.

    No other signal counts. A thread that neither quotes nor links footage has
    declared no source, so both halves are ``None``; the thread head's permalink
    is provenance (``detected_from_url``), never the source. Absent an explicit
    designation, a coordinate link (Google Maps) or an article (host ``other``)
    is not a footage source.
    """
    for record in thread:
        if record.quoted is not None:
            quoted = record.quoted
            return (
                f"https://x.com/{quoted.handle}/status/{quoted.tweet_id}",
                quoted.created_at or None,
            )
    link = _declared_footage(thread)
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
    link = _declared_footage(thread)
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
    # The mirrors: the declared links the source slot didn't take, normalized
    # and capped (:func:`resolve_secondary_sources`).
    secondary_source_urls: list[str] = field(default_factory=list)
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)


def resolve_thread(thread: list[TweetRecord]) -> ResolvedTweet | None:
    """Resolve a stitched thread into a ``ResolvedTweet``. ``None`` for an empty
    thread; a coordinate-less thread still resolves (``coords == []``)."""
    if not thread:
        return None
    head = thread[0]
    # Expanded per record before the join: raw tweet text carries only opaque
    # ``t.co`` wrappers, which ``clean_proof_text`` strips, so an analyst's
    # ``Source:`` / reference line would reach the proof as a dangling label.
    own_text = "\n".join(
        expand_shortlinks(record.text, record.external_sources) for record in thread if record.text
    )
    source_url, source_iso = resolve_source(thread)
    source_media, proof_media = split_media(thread)
    detected_post_at = _posted_at(head.created_at)
    source_posted_at = _posted_at(source_iso) if source_iso else None
    return ResolvedTweet(
        detected_from_url=head.permalink,
        owner_handle=head.handle,
        text=own_text,
        created_at=head.created_at,
        quoted=next((record.quoted for record in thread if record.quoted is not None), None),
        op_media=[media for record in thread for media in record.media],
        coords=resolve_coords(thread),
        title=derive_title(own_text),
        proof_text=clean_proof_text(own_text),
        source_url=source_url,
        source_posted_at=source_posted_at,
        detected_post_at=detected_post_at,
        event_date=_event_date(head.created_at, detected_post_at),
        secondary_source_urls=resolve_secondary_sources(thread, source_url),
        source_media=source_media,
        proof_media=proof_media,
    )


def resolve_tweet(url: str, *, client: httpx.Client | None = None) -> ResolvedTweet | None:
    """The single-tweet entry: fetch ``url`` via syndication and resolve it.

    ``resolve_thread([record_from_syndication(url)])``. Used by the human
    import; the archive and the bot pass a stitched thread to
    ``resolve_thread`` (via ``detect``).
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
