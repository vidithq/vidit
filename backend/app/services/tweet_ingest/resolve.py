"""The engine: threads of ``TweetRecord`` resolve to a ``Resolution``.

A thread is a list of ``TweetRecord`` (``stitch``'s output, or what
``acquire.acquire_thread`` reads). :func:`resolve_threads` is the one core every
entry runs, so the bot, the paste and the archive cannot drift. It is pure (no
network, no database). Each thread yields one :class:`Detection` per coordinate,
or one refusal code; ``services/detection.persist_detections`` writes rows.
A coordinate-less thread with footage and a source also yields a
:class:`RequestDraft` beside the refusal, which ``services/detection.open_request``
turns into a ``requested`` row. Only the bot opens that exit
(``resolve_threads(..., with_requests=True)``), and only it gets
``request_not_possible`` for a thread it cannot serve.

Every derived field is filled only on an explicit signal in the analyst's text
(a quote, a link, a coordinate), otherwise empty: no self-source fallback, no
fabricated dates. The one exception is the media split, which moves only a
video, only into the source media slot, leaving ``source_url`` untouched
(:func:`split_media`).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
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
    QuotedTweet,
    TelegramFootage,
    TweetRecord,
    expand_shortlinks,
)
from .urls import (
    NO_HANDLE,
    TWITTER_URL_HOST_RE,
    X_STATUS_URL_RE,
    canonical_tweet_url,
    hostname,
    telegram_post_url,
    x_status_id,
)

# Why a thread produced nothing; the bot names it back to the analyst.
# ``POST_UNREADABLE`` is raised by the acquisition (X served no body), so no
# thread reaches the engine.
COORDS_MISSING = "coords_missing"
COORDS_INVALID = "coords_invalid"
POST_UNREADABLE = "post_unreadable"
# Raised by the write path: a request draft's footage was all refused by the
# evidence intake (over the size cap, or unreadable). Worded here because the
# reply reads one table.
FOOTAGE_UNUSABLE = "footage_unusable"
# ``COORDS_MISSING`` sharpened for a caller that asked for a request: the thread
# names a source but has no footage. Only on :attr:`Resolution.request_refusals`.
REQUEST_NOT_POSSIBLE = "request_not_possible"

# What a created detection still needs from its owner: warnings, not refusals.
# The first three are what the engine could not settle; the last four are what
# the row ended up with, raised by ``detection.persist_detections``.
SOURCE_AMBIGUOUS = "source_ambiguous"  # several candidate links, source left empty
SOURCE_MISSING = "source_missing"  # no candidate link and no quote
SEVERAL_COORDINATES = "several_coordinates"  # one thread, several detections
SOURCE_FOOTAGE_MISSING = "source_footage_missing"  # a declared source, no footage stored
SOURCE_FETCH_FAILED = "source_fetch_failed"  # the source could not be read, retries spent
SOURCE_DATE_UNKNOWN = "source_date_unknown"  # the source's post date came back unknown
DUPLICATE_MEDIA = "duplicate_media"  # the row's media is already on another event

# The one sentence every surface shows per code (bot reply, archive email, paste
# response). An unworded code fails ``test_engine_copy``.
#
# Constraints from the bot reply: each sentence is short (under
# ``bot.REPLY_MAX_WEIGHTED_LEN``) and linkless (X bills a link-carrying post
# about 13 times a plain one).
WARNING_MESSAGES: dict[str, str] = {
    SEVERAL_COORDINATES: "Several coordinates, one detection each",
    SOURCE_AMBIGUOUS: "Several possible sources. Pick one at review",
    SOURCE_MISSING: "No source link in the post. Add one at review",
    SOURCE_FOOTAGE_MISSING: "The source served no footage. Add it at review",
    SOURCE_FETCH_FAILED: "Source unreachable, no footage stored. Add it at review",
    SOURCE_DATE_UNKNOWN: "The source's post date is missing. Add it at review",
    DUPLICATE_MEDIA: "This footage is already on Vidit. Possible duplicate",
}

# The same, for refusals.
REFUSAL_MESSAGES: dict[str, str] = {
    COORDS_MISSING: "No coordinate in the post",
    COORDS_INVALID: "The coordinate is out of range (latitude ±90, longitude ±180)",
    POST_UNREADABLE: "Post not readable on X (age-restricted, withheld or gone)",
    FOOTAGE_UNUSABLE: "Footage too large or unreadable. Open the request by hand",
    REQUEST_NOT_POSSIBLE: "No coordinate and no footage. Attach the clip to open a request",
}


def _status_link_handle(url: str) -> str | None:
    """The handle of an X status link, ``None`` for a non-status or ``i/web/status`` URL."""
    if x_status_id(url) is None:
        return None
    try:
        parts = [p for p in urlparse(url).path.split("/") if p]
    except ValueError:
        return None
    if len(parts) >= 3 and parts[1] == "status":
        return parts[0]
    return None


def _is_own_status_link(url: str, owner_handle: str) -> bool:
    """Whether ``url`` is a status link to ``owner_handle``'s own post (a
    cross-reference, never a source)."""
    handle = _status_link_handle(url)
    return handle is not None and handle.lower() == owner_handle.lower()


def _is_non_status_x_link(url: str) -> bool:
    """Whether ``url`` points at X without naming a status (profile, search,
    hashtag). X footage lives only at a status."""
    return TWITTER_URL_HOST_RE.match(hostname(url)) is not None and (
        X_STATUS_URL_RE.search(url) is None
    )


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
    """The deduplicated source candidate URLs among ``urls``, in order.

    Host-blind: every link is a candidate except three that point at no footage:

    * a status link to ``owner_handle``'s own post;
    * an X link naming no status;
    * a Google Maps link.

    Duplicates collapse on :func:`link_identity`. A candidate is the link as
    written; what may be fetched is the chase's business (``chase.chase_post``).
    """
    candidates: list[str] = []
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
        candidates.append(url)
    return candidates


def quoted_posts(thread: list[TweetRecord]) -> list[QuotedTweet]:
    """The distinct posts ``thread`` quotes, in order, deduped on post id (several
    is the ambiguity :func:`sole_quote` refuses to pick between)."""
    posts: list[QuotedTweet] = []
    seen: set[str] = set()
    for record in thread:
        quoted = record.quoted
        if quoted is None or quoted.tweet_id in seen:
            continue
        seen.add(quoted.tweet_id)
        posts.append(quoted)
    return posts


def sole_quote(thread: list[TweetRecord]) -> QuotedTweet | None:
    """The one post ``thread`` quotes, ``None`` for none or several.

    Shared by :func:`resolve_source` and :func:`split_media`, so a detection
    cannot name one post and store another's footage.
    """
    posts = quoted_posts(thread)
    return posts[0] if len(posts) == 1 else None


def thread_candidates(thread: list[TweetRecord]) -> list[str]:
    """The thread's source candidates: quoted posts, then links, through
    :func:`source_candidates` under the head's handle.

    X also writes the quoted permalink into the links; both collapse on
    :func:`link_identity`.
    """
    quoted = [canonical_tweet_url(post.tweet_id, post.handle) for post in quoted_posts(thread)]
    links = [link.url for record in thread for link in record.external_sources]
    return source_candidates(quoted + links, owner_handle=thread[0].handle if thread else "")


def sole_candidate(thread: list[TweetRecord]) -> str | None:
    """The thread's one source candidate, ``None`` for none or several.

    Several are ambiguous: the slot stays empty and all land in the secondary
    links. The chase reads the same answer, so it never fetches a link the
    resolution will not store.
    """
    candidates = thread_candidates(thread)
    return candidates[0] if len(candidates) == 1 else None


def resolve_secondary_sources(thread: list[TweetRecord], source_url: str | None) -> list[str]:
    """The mirrors: the source candidates the slot did not take.

    The candidate matching ``source_url`` by identity is excluded; when the
    source was ambiguous every candidate lands here. Blanks and the cap are the
    normalizer's job.
    """
    primary = link_identity(source_url) if source_url else None
    urls = [
        candidate for candidate in thread_candidates(thread) if link_identity(candidate) != primary
    ]
    # Local import keeps ``tweet_ingest`` importable without the service layer.
    from app.services.events import truncate_secondary_source_urls

    return truncate_secondary_source_urls(urls, source_url)


def _chased_footage(thread: list[TweetRecord], link: str) -> TelegramFootage | None:
    """The off-platform footage chased for the resolved source ``link``.

    Only when a record carries a chase filed under that exact URL (hence a
    chaser returns the target as written). ``None`` degrades the source to
    link-only. Callers reach this after ruling out a quote.
    """
    return next(
        (
            record.telegram
            for record in thread
            if record.telegram is not None and record.telegram.url == link
        ),
        None,
    )


def resolve_source(thread: list[TweetRecord]) -> tuple[str | None, str | None]:
    """The source URL and its post date (ISO 8601), either may be ``None``.

    A quote outranks links (including a status the acquisition chased into the
    quote slot): the quoted tweet is the source and supplies the date. One quoted
    post takes the slot (:func:`sole_quote`); two different quoted posts are
    ambiguous like two links, so the slot stays empty and both land in the
    mirrors. Failing a quote, the one candidate is the source
    (:func:`sole_candidate`), dated only if its post was chased.

    No other signal counts. The head's own post is provenance, never the source.
    """
    quote = sole_quote(thread)
    if quote is not None:
        return canonical_tweet_url(quote.tweet_id, quote.handle), quote.created_at or None
    if quoted_posts(thread):
        return None, None
    link = sole_candidate(thread)
    if link is not None:
        footage = _chased_footage(thread, link)
        return link, (footage.posted_at if footage is not None else None)
    return None, None


def split_media(thread: list[TweetRecord]) -> tuple[list[ParsedMedia], list[ParsedMedia]]:
    """``(source_media, proof_media)``: footage vs the analyst's annotation.

    The source media is that of the post :func:`resolve_source` named: the quoted
    tweet's, else the chased link's footage (a chase that served none leaves the
    slot empty).

    With the slot still empty, the thread's first own video fills it and leaves
    the proof (the proof document embeds images only, so a video left there
    would be lost). Photos are never promoted (map crops, annotated frames), and
    a quote keeps precedence even with no media.
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
    """Where the first video sits in ``media``, or ``None``.

    The :func:`split_media` promotion rule, exposed so the request branch can
    ask it too. Returns the position so a caller that removes it walks once.
    """
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
        handle = _status_link_handle(url)
        return canonical_tweet_url(status_id, handle if handle is not None else NO_HANDLE)
    return telegram_post_url(url) or url


@dataclass(frozen=True)
class Detection:
    """One coordinate's worth of a thread: the fields a ``detected`` row needs.

    Plain data: ``services/detection.persist_detections`` owns persistence and
    the ``(detected_from_tweet_id, coordinate)`` idempotency. Detections of one
    thread share source, proof, dates and provenance.
    """

    coordinate: ParsedCoord
    title: str
    # Plain text; the caller wraps it into the JSONB proof document.
    proof_text: str
    # The declared source, distinct from ``detected_from_url``. None without a
    # quote or exactly one candidate link.
    source_url: str | None
    # The geoloc post: its id is the identity every surface keys on. The id is
    # ``None`` only for a non-numeric one, which no upstream writes.
    detected_from_tweet_id: int | None
    detected_from_url: str
    # Every post id of the thread, anchor included, in order. Entries anchor
    # differently on one self-thread, so this lets the write path recognise one
    # geolocation whichever entry read it. Non-numeric ids are dropped.
    thread_tweet_ids: tuple[int, ...]
    # Provisional: the geoloc tweet's post date; the owner corrects it at submit.
    event_date: date | None
    # UTC, only when known (a dated quote or chased post); never the geoloc tweet's date.
    source_posted_at: datetime | None
    # When the analyst posted this geolocation (``detected_post_at``).
    detected_post_at: datetime | None
    # The mirrors (:func:`resolve_secondary_sources`); prefill the secondary links.
    secondary_source_urls: list[str] = field(default_factory=list)
    # role=source (at most one) vs role=proof.
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)
    # The chase failed because the upstream would not answer (a chaser's
    # ``transient_failure``). Lets the write path raise ``SOURCE_FETCH_FAILED``
    # (worth importing again) instead of ``SOURCE_FOOTAGE_MISSING``.
    source_fetch_failed: bool = False
    # What the owner still has to settle (the warning constants above); shared by
    # every detection of one thread.
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RequestDraft:
    """A coordinate-less mirror post's worth of a thread: the fields a
    ``requested`` row needs.

    The engine's second exit beside :class:`Detection`, emitted beside the
    ``coords_missing`` refusal, not instead of it. Plain data:
    ``services/detection.open_request`` writes it via ``services/events.create_request``.
    """

    title: str
    proof_text: str
    # In :func:`request_source_url`'s spelling; never ``None`` (no source is a refusal).
    source_url: str
    # UTC, only when the chase served one.
    source_posted_at: datetime | None
    # Provisional: the mirror post's date; corrected at fulfilment.
    event_date: date | None
    detected_post_at: datetime | None
    # The provenance every entry keys a re-import on; required (a draft without
    # an id is refused), so the write path always has a match leg.
    detected_from_tweet_id: int
    detected_from_url: str
    thread_tweet_ids: tuple[int, ...]
    secondary_source_urls: list[str]
    # Best first: the source's footage, then the analyst's own video.
    # ``events.create_request`` requires a file; the write path takes the first
    # that fetches (as ``detection._resolve_media`` does).
    footage_candidates: list[ParsedMedia]
    # The chase for the source found nothing to take (``not_accessible``; a
    # ``transient_failure`` drafts nothing, see :func:`_request_draft`). Mirrors
    # ``Detection.source_fetch_failed``; only lets ``detection._write_warnings``
    # tell the two warnings apart should the row land footage-less.
    source_fetch_failed: bool = False
    # Always empty (a draft settles every field); kept so both exits satisfy
    # the ``detection._write_warnings`` protocol.
    warnings: list[str] = field(default_factory=list)


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
    # One draft per coordinate-less thread with footage and a source, emitted
    # beside its ``coords_missing`` refusal (:attr:`reason` and :attr:`refusals`
    # are unchanged).
    requests: list[RequestDraft] = field(default_factory=list)
    # Threads refused, keyed by the refusal constants. One-thread entries read
    # :attr:`reason`; an export reads the counts.
    refusals: dict[str, int] = field(default_factory=dict)
    # Why a coordinate-less thread yielded no draft (``REQUEST_NOT_POSSIBLE``),
    # only for a caller that asked for requests and a thread that can never yield one.
    request_refusals: dict[str, int] = field(default_factory=dict)

    @property
    def warnings(self) -> dict[str, int]:
        """Detections per warning, counted as read, not as persisted."""
        counts: dict[str, int] = {}
        for detection in self.detections:
            for warning in detection.warnings:
                counts[warning] = counts.get(warning, 0) + 1
        return counts

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
    """``thread`` without retweets (:func:`extract.is_retweet`), which would file
    a stranger's geolocation under the analyst. The archive reader also drops
    them earlier."""
    return [record for record in thread if not is_retweet(record.text)]


def _warnings_for(
    coords: list[ParsedCoord], source_url: str | None, mirrors: list[str]
) -> list[str]:
    """What the resolution could not settle, in reply order.

    An empty source is ambiguous if the mirrors hold candidates, else missing.
    """
    warnings: list[str] = []
    if len(coords) > 1:
        warnings.append(SEVERAL_COORDINATES)
    if source_url is None:
        warnings.append(SOURCE_AMBIGUOUS if mirrors else SOURCE_MISSING)
    return warnings


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
    refusals: dict[str, int] = {}
    request_refusals: dict[str, int] = {}
    for thread in threads:
        found, refusal, draft, request_refusal = _thread_detections(
            thread, with_requests=with_requests
        )
        detections.extend(found)
        if draft is not None:
            requests.append(draft)
        if refusal is not None:
            refusals[refusal] = refusals.get(refusal, 0) + 1
        if request_refusal is not None:
            request_refusals[request_refusal] = request_refusals.get(request_refusal, 0) + 1
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
    draft a coordinate-less thread may yield (or the code naming why not).

    Two reasons: a coordinate-shaped string outside the world
    (``COORDS_INVALID``), or none in the analyst's own text (``COORDS_MISSING``,
    including an empty or retweet-only thread). Detections carry their needs on
    ``warnings``.

    The draft rides only on the ``COORDS_MISSING`` leg (:func:`_request_draft`),
    with the refusal; ``REQUEST_NOT_POSSIBLE`` rides there in the fourth slot.
    """
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
    if not scan.coords:
        if scan.out_of_bounds:
            return [], COORDS_INVALID, None, None
        if not with_requests:
            return [], COORDS_MISSING, None, None
        draft, request_refusal = _request_draft(posts, own_text)
        return [], COORDS_MISSING, draft, request_refusal
    source_url, source_iso = resolve_source(posts)
    source_media, proof_media = split_media(posts)
    detected_post_at = _posted_at(head.created_at)
    secondary_source_urls = resolve_secondary_sources(posts, source_url)
    # Derived once: the thread's detections differ only on the coordinate.
    title = derive_title(own_text)
    proof_text = clean_proof_text(own_text)
    warnings = _warnings_for(scan.coords, source_url, secondary_source_urls)
    # Every post of the thread (retweets already dropped): what the write path
    # recognises a re-import by.
    thread_tweet_ids = tuple(
        tweet_id
        for tweet_id in (_tweet_id(post.tweet_id) for post in posts)
        if tweet_id is not None
    )
    return (
        [
            Detection(
                coordinate=coord,
                title=title,
                proof_text=proof_text,
                source_url=source_url,
                detected_from_tweet_id=_tweet_id(head.tweet_id),
                detected_from_url=canonical_tweet_url(head.tweet_id, head.handle),
                thread_tweet_ids=thread_tweet_ids,
                event_date=_event_date(head.created_at, detected_post_at),
                source_posted_at=_posted_at(source_iso) if source_iso else None,
                detected_post_at=detected_post_at,
                secondary_source_urls=secondary_source_urls,
                source_media=source_media,
                proof_media=proof_media,
                source_fetch_failed=any(
                    post.chase_outcome == "transient_failure" for post in posts
                ),
                warnings=warnings,
            )
            for coord in scan.coords
        ],
        None,
        None,
        None,
    )


def _request_draft(
    posts: list[TweetRecord], own_text: str
) -> tuple[RequestDraft | None, str | None]:
    """The request a coordinate-less thread yields, or the code naming why not.

    Uses the same derivations as :func:`_thread_detections`. Six conditions must
    hold, else the thread keeps its plain refusal:

    * the head has a usable post id (the re-import match key);
    * no chase failed transiently (a re-tag can still read that source, and a
      request opened over the analyst's copy would keep the re-tag off via dedup);
    * the thread resolved a source, in :func:`request_source_url`'s spelling
      (the column refuses a row without one);
    * no quoted post carries a coordinate (that is a geolocation, not a request;
      shortlinks are expanded so a maps link behind ``t.co`` is read);
    * the thread carries footage: the source's media, else the first own video
      left in the annotation slot (``create_request`` requires a file; on hosts
      the chase does not read, that is the analyst's own video);
    * the title is not empty (``create_request`` requires one).

    Only a thread pointing at footage with none to store is actionable, so it
    returns ``REQUEST_NOT_POSSIBLE``. The other failures return ``None``,
    keeping the plain ``COORDS_MISSING``, since naming them would mislead (a
    retry, a quoted coordinate, a blank title, or no declared source).
    """
    head = posts[0]
    tweet_id = _tweet_id(head.tweet_id)
    if tweet_id is None:
        return None, None
    if any(post.chase_outcome == "transient_failure" for post in posts):
        return None, None
    resolved, source_iso = resolve_source(posts)
    if resolved is None:
        # Nothing pointed at (no link or quote, or several candidates): keep the flat refusal.
        return None, None
    source_url = request_source_url(resolved)
    if any(
        scan_coords(expand_shortlinks(quoted.text, quoted.external_sources)).coords
        for quoted in quoted_posts(posts)
    ):
        return None, None
    source_media, proof_media = split_media(posts)
    candidates = list(source_media)
    fallback = first_own_video_index(proof_media)
    if fallback is not None:
        # Reached when the chase served a post with no media: the analyst's
        # re-upload is the only footage the row can be born with.
        candidates.append(proof_media[fallback])
    if not candidates:
        return None, REQUEST_NOT_POSSIBLE
    title = derive_title(own_text)
    if not title:
        return None, None
    detected_post_at = _posted_at(head.created_at)
    draft = RequestDraft(
        title=title,
        proof_text=clean_proof_text(own_text),
        source_url=source_url,
        source_posted_at=_posted_at(source_iso) if source_iso else None,
        event_date=_event_date(head.created_at, detected_post_at),
        detected_post_at=detected_post_at,
        detected_from_tweet_id=tweet_id,
        detected_from_url=canonical_tweet_url(head.tweet_id, head.handle),
        thread_tweet_ids=tuple(
            post_id
            for post_id in (_tweet_id(post.tweet_id) for post in posts)
            if post_id is not None
        ),
        secondary_source_urls=resolve_secondary_sources(posts, source_url),
        footage_candidates=candidates,
        # The chase answered with nothing to take (post gone or restricted).
        # The row is never footage-less, so this only lets the write path tell
        # the warning codes apart if one ever lands without footage.
        source_fetch_failed=any(post.chase_outcome == "not_accessible" for post in posts),
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
    """The provisional ``event_date``: the geoloc tweet's post date.

    Falls back to a valid ``YYYY-MM-DD`` prefix when the time is garbled. An
    unparseable value yields None, never a fabricated epoch.
    """
    if posted_at is not None:
        return posted_at.date()
    try:
        return date.fromisoformat(created_at[:10])
    except ValueError:
        return None
