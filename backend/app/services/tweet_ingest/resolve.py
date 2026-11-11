"""The engine: threads of ``TweetRecord`` resolve to a ``Resolution``. Pure: no network, no database."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Final, Literal, TypedDict
from urllib.parse import parse_qsl, urlencode, urlparse

from .extract import (
    ParsedCoord,
    clean_proof_text,
    derive_title,
    is_retweet,
    scan_coords,
    strip_bot_tag,
)
from .records import (
    ParsedMedia,
    SourcePost,
    TweetRecord,
    expand_shortlinks,
)
from .urls import (
    NO_HANDLE,
    TWITTER_URL_HOST_RE,
    ContextKind,
    canonical_tweet_url,
    context_host,
    hostname,
    telegram_post_url,
    x_status_handle,
    x_status_id,
    x_status_posted_at,
)

COORDS_MISSING = "coords_missing"
COORDS_INVALID = "coords_invalid"
POST_UNREADABLE: Final = "post_unreadable"
# Raised by the write path, worded here because the reply reads one table.
FOOTAGE_UNUSABLE = "footage_unusable"
REQUEST_NOT_POSSIBLE = "request_not_possible"
THREAD_TRUNCATED = "thread_truncated"

# The first three are raised by the engine, the last four by ``detection.persist_detections``.
SOURCE_AMBIGUOUS = "source_ambiguous"
SOURCE_MISSING = "source_missing"
SEVERAL_COORDINATES = "several_coordinates"
SOURCE_FOOTAGE_MISSING = "source_footage_missing"
SOURCE_FETCH_FAILED = "source_fetch_failed"
SOURCE_DATE_UNKNOWN = "source_date_unknown"
DUPLICATE_MEDIA = "duplicate_media"

# The one sentence every surface shows per code; an unworded code fails ``test_engine_copy``.
# Each sentence stays under ``bot.REPLY_MAX_WEIGHTED_LEN`` and linkless (X bills a
# link-carrying post about 13 times a plain one).
WARNING_MESSAGES: dict[str, str] = {
    SEVERAL_COORDINATES: "Several coordinates, one detection each",
    SOURCE_AMBIGUOUS: "Several source links. Move or drop them at review",
    SOURCE_MISSING: "No footage link in the post. Add one at review",
    SOURCE_FOOTAGE_MISSING: "The source served no footage. Add it at review",
    SOURCE_FETCH_FAILED: "Source unreachable, no footage stored. Add it at review",
    SOURCE_DATE_UNKNOWN: "The source's post date is missing. Add it at review",
    DUPLICATE_MEDIA: "This footage is already on Vidit. Possible duplicate",
}

REFUSAL_MESSAGES: dict[str, str] = {
    COORDS_MISSING: "No coordinate in the post",
    COORDS_INVALID: "The coordinate is out of range (latitude ±90, longitude ±180)",
    POST_UNREADABLE: "Post not readable on X (age-restricted, withheld or gone)",
    FOOTAGE_UNUSABLE: "Footage too large or unreadable. Open the request by hand",
    REQUEST_NOT_POSSIBLE: "No coordinate and no footage. Attach the clip to open a request",
    THREAD_TRUNCATED: "Could not read the whole thread. Try again from the coordinate post",
}


def _is_own_status_link(url: str, owner_handle: str) -> bool:
    """Whether ``url`` is a status link to ``owner_handle``'s own post (a
    cross-reference, never a source)."""
    handle = x_status_handle(url)
    return handle is not None and handle.lower() == owner_handle.lower()


def _is_non_status_x_link(url: str) -> bool:
    """Whether ``url`` points at X without naming a status (profile, search,
    hashtag). X footage lives only at a status."""
    return TWITTER_URL_HOST_RE.match(hostname(url)) is not None and x_status_id(url) is None


_GOOGLE_HOST_RE = re.compile(r"^(?:www\.|maps\.)?google\.[a-z0-9.\-]+$", re.IGNORECASE)


def _is_coordinate_link(url: str) -> bool:
    """Whether ``url`` is a Google Maps link (never a source candidate).

    Counts the ``maps.`` subdomain, a ``/maps`` path on a Google host, and the
    share forms ``maps.app.goo.gl`` and legacy ``goo.gl/maps/``. A share link
    has no coordinate for ``extract._GMAPS_RE``; excluding it here keeps it out
    of the source slot.
    """
    host = hostname(url)
    if host == "maps.app.goo.gl":
        return True
    path = urlparse(url).path.lower()
    if host == "goo.gl":
        # The bare shortener serves every Google product: only ``/maps/`` counts.
        return path.startswith("/maps/")
    if _GOOGLE_HOST_RE.match(host) is None:
        return False
    return host.startswith("maps.") or path.startswith("/maps")


# Share / campaign parameters: links differing only in these are one target.
_TRACKING_QUERY_PARAMS = frozenset(
    {"s", "si", "t", "feature", "ref", "ref_src", "ref_url", "fbclid", "gclid", "igshid"}
)


def _identifying_query(query: str) -> str:
    """``query`` without tracking parameters, the rest sorted."""
    kept = sorted(
        (name, value)
        for name, value in parse_qsl(query, keep_blank_values=True)
        if name.lower() not in _TRACKING_QUERY_PARAMS and not name.lower().startswith("utm_")
    )
    return urlencode(kept)


def link_identity(url: str) -> str:
    """The identity two spellings of one link share (the one dedup rule).

    An X status keys on its status id. Any other link keys on host, path and
    the identifying query (:func:`_identifying_query`), so ``watch?v=AAA`` and
    ``watch?v=BBB`` differ while ``watch?v=AAA&si=…`` is the same link.
    """
    status_id = x_status_id(url)
    if status_id is not None:
        return f"x:{status_id}"
    parsed = urlparse(url)
    base = f"{hostname(url)}{parsed.path.rstrip('/')}"
    query = _identifying_query(parsed.query)
    return f"{base}?{query}" if query else base


def source_candidates(urls: Iterable[str], *, owner_handle: str) -> list[str]:
    """The footage candidate URLs among ``urls``, in order, deduplicated on :func:`link_identity`.

    A candidate is the link as written; what may be fetched is the chase's business.
    """
    candidates: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if _is_own_status_link(url, owner_handle) or _is_non_status_x_link(url):
            continue
        if _is_coordinate_link(url) or context_host(url) is not None:
            continue
        key = link_identity(url)
        if key in seen:
            continue
        seen.add(key)
        candidates.append(url)
    return candidates


def context_links(urls: Iterable[str]) -> list[str]:
    """The links on a context host among ``urls``, in order, a Google Maps link aside."""
    links: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if _is_coordinate_link(url) or context_host(url) is None:
            continue
        key = link_identity(url)
        if key not in seen:
            seen.add(key)
            links.append(url)
    return links


def quoted_posts(thread: list[TweetRecord]) -> list[SourcePost]:
    """The distinct posts ``thread`` quotes, in order, deduped on post id (several
    is the ambiguity :func:`sole_quote` refuses to pick between)."""
    posts: list[SourcePost] = []
    seen: set[str | None] = set()
    for record in thread:
        quoted = record.quoted
        if quoted is None or quoted.status_id in seen:
            continue
        seen.add(quoted.status_id)
        posts.append(quoted)
    return posts


def sole_quote(thread: list[TweetRecord]) -> SourcePost | None:
    """The one post ``thread`` quotes, ``None`` for none or several.

    Shared by :func:`resolve_source` and :func:`split_media`, so a detection
    cannot name one post and store another's footage.
    """
    posts = quoted_posts(thread)
    return posts[0] if len(posts) == 1 else None


def _thread_links(thread: list[TweetRecord]) -> list[str]:
    """Every link the thread names: its quoted posts' permalinks, then its links."""
    quoted = [post.url for post in quoted_posts(thread)]
    return quoted + [link.url for record in thread for link in record.external_sources]


def thread_candidates(thread: list[TweetRecord]) -> list[str]:
    """The thread's footage candidates: quoted posts, then links, under the head's handle.

    X also writes the quoted permalink into the links; both collapse on :func:`link_identity`.
    """
    return source_candidates(_thread_links(thread), owner_handle=thread[0].handle if thread else "")


def sole_candidate(thread: list[TweetRecord]) -> str | None:
    """The thread's one source candidate, ``None`` for none or several.

    The chase reads the same answer, so it never fetches a link the resolution will not store.
    """
    candidates = thread_candidates(thread)
    return candidates[0] if len(candidates) == 1 else None


@dataclass(frozen=True)
class LinkSource:
    """One file-less source an import writes from one link: a footage mirror or a context link."""

    url: str
    posted_at: datetime | None = None
    level: Literal["direct", "context"] = "direct"
    kind: Literal["unknown"] | ContextKind = "unknown"
    title: str = ""


def _link_source(url: str) -> LinkSource:
    host = context_host(url)
    if host is not None:
        return LinkSource(url=url, level="context", kind=host.kind, title=host.title)
    return LinkSource(url=url, posted_at=x_status_posted_at(url))


def resolve_secondary_sources(
    thread: list[TweetRecord], source_url: str | None
) -> list[LinkSource]:
    """The sources beside the declared one: the footage candidates the slot did not take, then
    the context links, cut so the declared source and these fit ``MAX_SOURCES_PER_EVENT``.
    """
    primary = link_identity(source_url) if source_url else None
    links = _thread_links(thread)
    candidates = source_candidates(links, owner_handle=thread[0].handle if thread else "")
    urls = [
        candidate for candidate in candidates if link_identity(candidate) != primary
    ] + context_links(links)
    # Local import keeps ``tweet_ingest`` importable without the model layer.
    from app.models.source import MAX_SOURCES_PER_EVENT

    cleaned: list[str] = []
    for raw in urls:
        url = raw.strip()
        if url and url != (source_url or "").strip() and url not in cleaned:
            cleaned.append(url)
    return [_link_source(url) for url in cleaned[: MAX_SOURCES_PER_EVENT - 1]]


def footage_candidates(sources: list[LinkSource]) -> list[LinkSource]:
    return [source for source in sources if source.level == "direct"]


def _chased_footage(thread: list[TweetRecord], link: str) -> SourcePost | None:
    """The post chased for the resolved source ``link``, filed under that exact URL (a chaser
    returns the target as written). Callers reach this after ruling out a quote.
    """
    return next(
        (
            record.linked
            for record in thread
            if record.linked is not None and record.linked.url == link
        ),
        None,
    )


def resolve_source(thread: list[TweetRecord]) -> tuple[str | None, datetime | None]:
    """The source URL and its post date (UTC), either may be ``None``.

    A sole quote outranks links (a chased status sits in the quote slot too); two quoted posts
    are ambiguous. Failing a quote, the sole candidate is the source.
    """
    quote = sole_quote(thread)
    if quote is not None:
        return quote.url, _source_posted_at(quote.url, quote.posted_at)
    if quoted_posts(thread):
        return None, None
    link = sole_candidate(thread)
    if link is not None:
        footage = _chased_footage(thread, link)
        return link, _source_posted_at(link, footage.posted_at if footage is not None else None)
    return None, None


def _source_posted_at(url: str, served: str | None) -> datetime | None:
    """The source's post date: an X status's id, else the date its read served (ISO 8601)."""
    return x_status_posted_at(url) or (_posted_at(served) if served else None)


def split_media(thread: list[TweetRecord]) -> tuple[list[ParsedMedia], list[ParsedMedia]]:
    """``(source_media, proof_media)``: the media of the post :func:`resolve_source` named, else
    the thread's first own video, which the proof body (images only) would lose.
    """
    own_media = [media for record in thread for media in record.media]
    if quoted_posts(thread):
        # A quote wins even with no media; a Telegram link is never consulted.
        # Two different quoted posts leave the slot empty (``sole_quote`` avoids
        # storing one post's video under a source naming the other), and their
        # media is dropped, not filed as annotation.
        quote = sole_quote(thread)
        return (list(quote.media) if quote is not None else []), own_media
    link = sole_candidate(thread)
    if link is not None:
        footage = _chased_footage(thread, link)
        if footage is not None:
            return list(footage.media), own_media
    index = first_own_video_index(own_media)
    if index is None:
        return [], own_media
    return [own_media[index]], own_media[:index] + own_media[index + 1 :]


def first_own_video_index(media: list[ParsedMedia]) -> int | None:
    """Where the first video sits in ``media``, or ``None``."""
    return next((index for index, item in enumerate(media) if item.kind == "video"), None)


def request_source_url(url: str) -> str:
    """``url`` in the one spelling a request stores.

    An X status and a public Telegram post are canonicalized
    (:func:`urls.canonical_tweet_url`, :func:`urls.telegram_post_url`): the
    re-tag dedup compares ``source_url`` as a string (``detection._match_legs``),
    so ``https://www.t.me/ch/351?single`` and ``https://t.me/ch/351`` must match.
    Other hosts are stored as written.
    """
    status_id = x_status_id(url)
    if status_id is not None:
        handle = x_status_handle(url)
        return canonical_tweet_url(status_id, handle if handle is not None else NO_HANDLE)
    return telegram_post_url(url) or url


@dataclass(frozen=True)
class Detection:
    """One coordinate's worth of a thread: the fields a ``detected`` row needs.

    Plain data: ``services/detection.persist_detections`` owns persistence and
    the ``(detected_from_post_id, coordinate)`` idempotency. Detections of one
    thread share source, proof, dates and provenance.
    """

    coordinate: ParsedCoord
    title: str
    # Plain text; the caller wraps it into the HTML proof body.
    proof_text: str
    # The declared source, distinct from ``detected_from_url``. None without a
    # quote or exactly one candidate link.
    source_url: str | None
    # The geoloc post: its id is the identity every surface keys on. The id is
    # ``None`` only for a non-numeric one, which no upstream writes.
    detected_from_post_id: int | None
    detected_from_url: str
    # Every post id of the thread, anchor included, in order. Entries anchor
    # differently on one self-thread, so this lets the write path recognise one
    # geolocation whichever entry read it. Non-numeric ids are dropped.
    thread_tweet_ids: tuple[int, ...]
    # Provisional: the geoloc tweet's post date; the owner corrects it at submit.
    occurred_date: date | None
    # UTC, only when known (an X status's id, a dated quote or chased post); never the geoloc
    # tweet's date.
    source_posted_at: datetime | None
    detected_post_at: datetime | None
    secondary_sources: list[LinkSource] = field(default_factory=list)
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)
    # A chase came back ``transient_failure``: ``SOURCE_FETCH_FAILED``, not ``SOURCE_FOOTAGE_MISSING``.
    source_fetch_failed: bool = False
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RequestDraft:
    """A coordinate-less mirror post's worth of a thread: the fields a ``requested`` row needs.

    Emitted beside the ``coords_missing`` refusal, not instead of it.
    """

    title: str
    proof_text: str
    # In :func:`request_source_url`'s spelling; never ``None`` (no source is a refusal).
    source_url: str
    # UTC, only when the chase served one.
    source_posted_at: datetime | None
    # Provisional: the mirror post's date; corrected at fulfilment.
    occurred_date: date | None
    detected_post_at: datetime | None
    # The provenance every entry keys a re-import on; required (a draft without
    # an id is refused), so the write path always has a match leg.
    detected_from_post_id: int
    detected_from_url: str
    thread_tweet_ids: tuple[int, ...]
    secondary_sources: list[LinkSource]
    # Best first: the source's footage, then the analyst's own video.
    # ``events.submit_request`` requires a file; the write path takes the first
    # that fetches (as ``detection._resolve_media`` does).
    footage_candidates: list[ParsedMedia]


def sole_refusal(refusals: dict[str, int]) -> str | None:
    """The one refusal code to name, ``None`` when nothing refused or several
    reasons differ (an export reads the counts instead of picking a winner)."""
    return next(iter(refusals)) if len(refusals) == 1 else None


@dataclass(frozen=True)
class Resolution:
    """What a batch of threads resolves to.

    ``detections`` are in thread order, one thread's contiguous (the write path
    caches a thread's media on that).
    """

    detections: list[Detection] = field(default_factory=list)
    requests: list[RequestDraft] = field(default_factory=list)
    refusals: dict[str, int] = field(default_factory=dict)
    request_refusals: dict[str, int] = field(default_factory=dict)

    @property
    def warnings(self) -> dict[str, int]:
        """Detections per warning, counted as read, not as persisted."""
        return Counter(warning for detection in self.detections for warning in detection.warnings)

    @property
    def reason(self) -> str | None:
        """The one refusal to name when no detection resolved."""
        return None if self.detections else sole_refusal(self.refusals)

    @property
    def request_reason(self) -> str | None:
        """The one code naming why no request opened, or ``None``.

        Set when requests were asked for, none opened, and every candidate
        thread was refused alike. The caller reads it instead of :attr:`reason`
        so the analyst is told to attach the clip, not add a coordinate.
        """
        return None if self.requests else sole_refusal(self.request_refusals)


def own_posts(thread: list[TweetRecord]) -> list[TweetRecord]:
    """``thread`` without retweets, which would file a stranger's geolocation under the analyst."""
    return [record for record in thread if not is_retweet(record.text)]


def _warnings_for(
    coords: list[ParsedCoord], source_url: str | None, secondary: list[LinkSource]
) -> list[str]:
    """What the resolution could not settle; a context link is never footage."""
    warnings: list[str] = []
    if len(coords) > 1:
        warnings.append(SEVERAL_COORDINATES)
    if source_url is None:
        warnings.append(SOURCE_AMBIGUOUS if footage_candidates(secondary) else SOURCE_MISSING)
    return warnings


class _ThreadFields(TypedDict):
    """What a thread's detections and its request draft read alike, derived once."""

    title: str
    proof_text: str
    source_posted_at: datetime | None
    occurred_date: date | None
    detected_post_at: datetime | None
    detected_from_url: str
    thread_tweet_ids: tuple[int, ...]


def resolve_threads(threads: list[list[TweetRecord]], *, with_requests: bool = False) -> Resolution:
    """The engine: every thread's detections, plus one count per refusal code.

    Pure and in memory, so an export resolves in full before any row is written,
    which gives its progress callback an exact total.

    ``with_requests`` opens the second exit; only the bot passes it. Drafting
    requests for every coordinate-less thread of a 30k-post export would hold
    the drafts and their media references for nothing.
    """
    detections: list[Detection] = []
    requests: list[RequestDraft] = []
    refusals: Counter[str] = Counter()
    request_refusals: Counter[str] = Counter()
    for thread in threads:
        found, refusal, draft, request_refusal = _thread_detections(
            thread, with_requests=with_requests
        )
        detections.extend(found)
        if draft is not None:
            requests.append(draft)
        if refusal is not None:
            refusals[refusal] += 1
        if request_refusal is not None:
            request_refusals[request_refusal] += 1
    return Resolution(
        detections=detections,
        requests=requests,
        refusals=refusals,
        request_refusals=request_refusals,
    )


def _thread_detections(
    thread: list[TweetRecord], *, with_requests: bool
) -> tuple[list[Detection], str | None, RequestDraft | None, str | None]:
    """One ``Detection`` per coordinate, or the refusal reason, plus the request
    draft a coordinate-less thread may yield (or the code naming why not)."""
    posts = own_posts(thread)
    if not posts:
        return [], COORDS_MISSING, None, None
    head = posts[0]
    # Expand ``t.co`` wrappers per record before the join, so reference links
    # reach the proof readable. The bot tag is addressing, so it goes. Local
    # import keeps ``tweet_ingest`` importable on its own.
    from app.config import settings

    joined = "\n".join(
        expand_shortlinks(record.text, record.external_sources) for record in posts if record.text
    )
    own_text = strip_bot_tag(joined, settings.x_bot_handle)
    # A coordinate solely in a third party's quoted post is that party's geolocation.
    scan = scan_coords(own_text)
    if not scan.coords and scan.out_of_bounds:
        return [], COORDS_INVALID, None, None
    if not scan.coords and not with_requests:
        return [], COORDS_MISSING, None, None
    source_url, source_posted_at = resolve_source(posts)
    source_media, proof_media = split_media(posts)
    detected_post_at = _posted_at(head.created_at)
    shared = _ThreadFields(
        title=derive_title(own_text),
        proof_text=clean_proof_text(own_text),
        source_posted_at=source_posted_at,
        occurred_date=_event_date(head.created_at, detected_post_at),
        detected_post_at=detected_post_at,
        detected_from_url=canonical_tweet_url(head.tweet_id, head.handle),
        # Retweets already dropped: what the write path recognises a re-import by.
        thread_tweet_ids=tuple(
            tweet_id
            for tweet_id in (_tweet_id(post.tweet_id) for post in posts)
            if tweet_id is not None
        ),
    )
    if not scan.coords:
        draft, request_refusal = _request_draft(
            posts, source_url, source_media, proof_media, shared
        )
        return [], COORDS_MISSING, draft, request_refusal
    secondary_sources = resolve_secondary_sources(posts, source_url)
    warnings = _warnings_for(scan.coords, source_url, secondary_sources)
    source_fetch_failed = any(post.chase_outcome == "transient_failure" for post in posts)
    return (
        [
            Detection(
                coordinate=coord,
                source_url=source_url,
                detected_from_post_id=_tweet_id(head.tweet_id),
                secondary_sources=secondary_sources,
                source_media=source_media,
                proof_media=proof_media,
                source_fetch_failed=source_fetch_failed,
                warnings=warnings,
                **shared,
            )
            for coord in scan.coords
        ],
        None,
        None,
        None,
    )


def _request_draft(
    posts: list[TweetRecord],
    resolved: str | None,
    source_media: list[ParsedMedia],
    proof_media: list[ParsedMedia],
    shared: _ThreadFields,
) -> tuple[RequestDraft | None, str | None]:
    """The request a coordinate-less thread yields, or the code naming why not.

    ``docs/ingestion.md`` lists the six conditions. A transient chase failure drafts nothing:
    a request opened over the analyst's copy would dedup away the later re-tag that reads the
    source. Only a thread pointing at footage with none to store is actionable, so only it
    returns ``REQUEST_NOT_POSSIBLE``.
    """
    tweet_id = _tweet_id(posts[0].tweet_id)
    if tweet_id is None:
        return None, None
    if any(post.chase_outcome == "transient_failure" for post in posts):
        return None, None
    if resolved is None:
        # Nothing pointed at (no link or quote, or several candidates): keep the flat refusal.
        return None, None
    if any(
        scan_coords(expand_shortlinks(quoted.text, quoted.external_sources)).coords
        for quoted in quoted_posts(posts)
    ):
        return None, None
    candidates = list(source_media)
    fallback = first_own_video_index(proof_media)
    if fallback is not None:
        # Reached when the chase served a post with no media: the analyst's
        # re-upload is the only footage the row can be born with.
        candidates.append(proof_media[fallback])
    if not candidates:
        return None, REQUEST_NOT_POSSIBLE
    if not shared["title"]:
        return None, None
    source_url = request_source_url(resolved)
    draft = RequestDraft(
        source_url=source_url,
        detected_from_post_id=tweet_id,
        secondary_sources=resolve_secondary_sources(posts, source_url),
        footage_candidates=candidates,
        **shared,
    )
    return draft, None


# A snowflake id fits the bigint column. The bound is still checked: an export
# is attacker-controlled and admits any digit string, which would fail the insert.
_MAX_TWEET_ID = 2**63 - 1


def _tweet_id(raw: str) -> int | None:
    """The post id as the ``events`` column holds it, ``None`` for a non-id
    (no upstream writes one; such a detection dedups on its source URL alone)."""
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if 0 <= value <= _MAX_TWEET_ID else None


def _posted_at(created_at: str) -> datetime | None:
    """Aware UTC datetime from an ISO 8601 timestamp, or None (``_event_date``
    still recovers the date prefix)."""
    try:
        parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _event_date(created_at: str, posted_at: datetime | None) -> date | None:
    """The provisional ``occurred_date``: the geoloc tweet's post date.

    Falls back to a valid ``YYYY-MM-DD`` prefix when the time is garbled. An
    unparseable value yields None, never a fabricated epoch.
    """
    if posted_at is not None:
        return posted_at.date()
    try:
        return date.fromisoformat(created_at[:10])
    except ValueError:
        return None
