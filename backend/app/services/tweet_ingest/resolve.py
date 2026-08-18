"""The engine: threads of ``TweetRecord`` resolve to a ``Resolution``.

A "thread" is a list of ``TweetRecord``: ``stitch``'s output for the archive, or
the one hop ``acquire.acquire_thread`` reads for the bot and the paste.
:func:`resolve_threads` is the single core every entry runs, so the bot, the
pasted import and the archive backfill cannot drift on coordinates, source,
dates, or media. It is pure: no network, no database. Each thread yields one
:class:`Draft` per coordinate it carries, or one refusal code when it yields
none; ``services/detection.persist_drafts`` is what turns a draft into a row.

Every derived field follows one contract: filled only on an explicit signal in
the analyst's own text (a quote, a link, a coordinate), otherwise empty. No
deduction: no self-source fallback, no fabricated dates. The media split is the
one place a thread's own attachment moves without such a signal, and only a
video, and only into the source media slot: ``source_url`` is untouched, so a
promotion never reads as a declared source (see :func:`split_media`).

The small ``resolve_source`` / ``split_media`` helpers are the pieces;
:func:`resolve_threads` composes them plus the coordinate / title / proof / date
derivations into the drafts.
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
    TWITTER_URL_HOST_RE,
    X_STATUS_URL_RE,
    canonical_tweet_url,
    hostname,
    x_status_id,
)

# ── The engine's vocabulary ───────────────────────────────────────────────

# Why a thread produced nothing. The entry that cares names it back to the
# analyst (the bot's failure reply); the other entries ignore it.
# ``POST_UNREADABLE`` is raised by the acquisition rather than here: X served no
# body at all, so no thread ever reached the engine.
COORDS_MISSING = "coords_missing"
COORDS_INVALID = "coords_invalid"
POST_UNREADABLE = "post_unreadable"

# What a created draft still needs from its owner. Warnings, not refusals: the
# draft lands either way and review is where they are answered. The first three
# are what the engine could not settle from the post; the last three are what
# the row ended up with, so ``detection.persist_drafts`` raises them once the
# write is done. One home for the vocabulary, whichever half raises a code.
SOURCE_AMBIGUOUS = "source_ambiguous"  # several candidate links, source left empty
SOURCE_MISSING = "source_missing"  # no candidate link and no quote
SEVERAL_COORDINATES = "several_coordinates"  # one thread, several drafts
SOURCE_FOOTAGE_MISSING = "source_footage_missing"  # a declared source, no footage stored
SOURCE_DATE_UNKNOWN = "source_date_unknown"  # the source's post date came back unknown
DUPLICATE_MEDIA = "duplicate_media"  # the row's media is already on another event

# The one sentence each code reads as, in the order the surfaces read them.
# Every surface that shows a code shows this sentence: the bot's in-thread reply
# behind its ⚠, the archive's outcome email behind a count of drafts, and the
# paste's response, which the import panel renders as it arrives. One home, so
# the three entries cannot tell an analyst three different things about one
# code, and adding a code to the vocabulary above without wording it here fails
# ``test_engine_copy``.
#
# Two constraints the table holds for its tightest surface, the reply: each
# sentence is short (a composed reply must stay under
# ``bot.REPLY_MAX_WEIGHTED_LEN``) and linkless (X bills a link-carrying post
# about 13 times a plain one).
WARNING_MESSAGES: dict[str, str] = {
    SEVERAL_COORDINATES: "Several coordinates, one draft each",
    SOURCE_AMBIGUOUS: "Several possible sources. Pick one at review",
    SOURCE_MISSING: "No source found. Add one at review",
    SOURCE_FOOTAGE_MISSING: "No footage from the source. Add it at review",
    SOURCE_DATE_UNKNOWN: "The source's post date is unknown. Check it at review",
    DUPLICATE_MEDIA: "Media already on Vidit. Possible duplicate",
}

# The same, for the refusals. A surface that names no refusal (the archive email
# reports counts) simply never reads this table.
REFUSAL_MESSAGES: dict[str, str] = {
    COORDS_MISSING: "No coordinate in the post",
    COORDS_INVALID: "The post's coordinate sits outside the world",
    POST_UNREADABLE: "Post not readable on X (age-restricted, withheld or gone)",
}


def _status_link_handle(url: str) -> str | None:
    """The handle segment of an X status link, or ``None`` when ``url`` names no
    status or is the handle-less ``i/web/status`` form."""
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
    return TWITTER_URL_HOST_RE.match(hostname(url)) is not None and (
        X_STATUS_URL_RE.search(url) is None
    )


_GOOGLE_HOST_RE = re.compile(r"^(?:www\.|maps\.)?google\.[a-z0-9.\-]+$", re.IGNORECASE)


def _is_coordinate_link(url: str) -> bool:
    """Whether ``url`` is a Google Maps link.

    A maps link is where the coordinate came from, not where the footage lives,
    and the coordinate extractors already read it (``extract._GMAPS_RE``). Both
    the ``maps.`` subdomain and a ``/maps`` path on a Google host count, plus the
    ``maps.app.goo.gl`` share form.
    """
    host = hostname(url)
    if host == "maps.app.goo.gl":
        return True
    if _GOOGLE_HOST_RE.match(host) is None:
        return False
    return host.startswith("maps.") or urlparse(url).path.lower().startswith("/maps")


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
    status_id = x_status_id(url)
    if status_id is not None:
        return f"x:{status_id}"
    parsed = urlparse(url)
    base = f"{hostname(url)}{parsed.path.rstrip('/')}"
    query = _identifying_query(parsed.query)
    return f"{base}?{query}" if query else base


def source_candidates(urls: Iterable[str], *, owner_handle: str) -> list[str]:
    """The deduplicated source candidate URLs among ``urls``, in order.

    Host-blind: every link the thread carries is a candidate unless it is one of
    the three exclusions, which are exclusions because they point at no footage
    at all rather than because of what platform they name:

    * a status link back to ``owner_handle``'s own post (a cross-reference);
    * an X link naming no status (a profile, a search);
    * a Google Maps link (a coordinate).

    So a TikTok, an Instagram post or a news article is a candidate exactly like
    an X status is. Duplicates collapse on :func:`link_identity`.

    A candidate is the link as the post wrote it and nothing more: what may be
    *fetched* from it is the chase's business (``chase.chase_post`` reads the
    host), and what is *stored* is this resolution's.
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
    """The distinct posts ``thread`` quotes, in thread order, deduped on post id.

    Two records quoting one post name one candidate; two records quoting two
    different posts name two, which is the ambiguity :func:`sole_quote` refuses
    to pick between.
    """
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
    """The one post ``thread`` quotes, ``None`` when it quotes none or several.

    The one rule :func:`resolve_source` and :func:`split_media` both read, so a
    draft cannot name one post as its source and store another post's footage.
    """
    posts = quoted_posts(thread)
    return posts[0] if len(posts) == 1 else None


def thread_candidates(thread: list[TweetRecord]) -> list[str]:
    """The thread's source candidates: the posts it quotes, then the links it
    carries, through :func:`source_candidates` under the thread head's handle.

    A quoted post is a candidate the analyst declared by quoting rather than by
    linking. X writes the quoted permalink into the links too, so the two
    spellings collapse on :func:`link_identity` and one quote is one candidate.
    """
    quoted = [canonical_tweet_url(post.tweet_id, post.handle) for post in quoted_posts(thread)]
    links = [link.url for record in thread for link in record.external_sources]
    return source_candidates(quoted + links, owner_handle=thread[0].handle if thread else "")


def sole_candidate(thread: list[TweetRecord]) -> str | None:
    """The thread's one source candidate, or ``None`` when it has none or
    several.

    Several candidates are ambiguous: the slot stays empty and every candidate
    lands in the secondary links for the analyst to promote one at review. The
    chase reads the same answer, so it never fetches a link the resolution will
    not store.
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
        candidate for candidate in thread_candidates(thread) if link_identity(candidate) != primary
    ]
    # Imported locally so the rest of ``tweet_ingest`` stays importable without
    # the app's service layer.
    from app.services.events import truncate_secondary_source_urls

    return truncate_secondary_source_urls(urls, source_url)


def _chased_footage(thread: list[TweetRecord], link: str) -> TelegramFootage | None:
    """The off-platform footage chased for the resolved source ``link``.

    Only when some record carries a chase filed under that exact URL, which is
    why a chaser returns the target as the post wrote it. ``None`` for any other
    link or when the chase found nothing, so the source degrades to link-only
    (url, no date, no media). Callers reach this only after the quote branch has
    been ruled out, so a quote always takes precedence over a link.
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

    A quote outranks links: the analyst quote-tweeted the footage, so the quoted
    tweet is the source and its date comes free. That includes a status the
    acquisition chased into the quote slot on the analyst's behalf. The thread's
    one quoted post takes the slot (:func:`sole_quote`); records quoting two
    different posts are as ambiguous as two candidate links and are answered the
    same way, with the slot left empty and both quoted statuses landing in the
    mirrors for review to pick from. Failing a quote, the thread's one source
    candidate is the source (:func:`sole_candidate`); a link whose post was
    chased carries its date, every other link is stored link-only.

    No other signal counts. A thread that neither quotes nor links anything has
    declared no source, so both halves are ``None``; the thread head's own post is
    provenance (``detected_from_tweet_id`` and the URL built from it), never the
    source.
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
    """``(source_media, proof_media)``.

    Footage (``source``) vs the analyst's annotation (``proof``): the footage is
    the media of the post :func:`resolve_source` named, so a quoted tweet's media
    is the only media that lands in the source slot, and it is the media of that
    same quoted post. When there is no quote but the resolved source is a link
    whose post was chased and served footage, that footage is the source media
    instead (a chase that served none leaves the slot empty).

    With the source slot still empty after both, the thread's first own video
    fills it and leaves the proof: a video an analyst attaches is the footage
    itself, and the proof document embeds images only, so leaving it in the
    annotation slot drops it entirely. Photos are never promoted (an analyst's
    photo is a map crop, a screenshot, an annotated frame), and a quote keeps
    absolute precedence even when it carried no media at all.
    """
    own_media = [media for record in thread for media in record.media]
    if quoted_posts(thread):
        # A quote takes precedence as the source (even when it carried no media),
        # so its media is the only footage; a Telegram link is never consulted.
        # Records quoting two different posts leave the source empty, and the
        # slot stays empty with them: storing one quoted post's video under a
        # draft that names the other post as its source is the mismatch this
        # reads ``sole_quote`` to avoid. The unnamed post's media is not the
        # analyst's own, so it is dropped rather than filed as annotation.
        quote = sole_quote(thread)
        return (list(quote.media) if quote is not None else []), own_media
    link = sole_candidate(thread)
    if link is not None:
        footage = _chased_footage(thread, link)
        if footage is not None:
            return list(footage.media), own_media
    video = next((i for i, media in enumerate(own_media) if media.kind == "video"), None)
    if video is None:
        return [], own_media
    return [own_media[video]], own_media[:video] + own_media[video + 1 :]


@dataclass(frozen=True)
class Draft:
    """One coordinate's worth of a thread: the fields a ``detected`` row needs.

    Plain data, never an ORM row: ``services/detection.persist_drafts`` turns
    each into an ``Event`` and owns persistence, evidence and the
    ``(detected_from_tweet_id, coordinate)`` idempotency. A thread carrying
    several coordinates yields one draft each, all sharing the same source,
    proof, dates and provenance.
    """

    coordinate: ParsedCoord
    title: str
    # Plain-text proof body (the thread's text, media wrappers dropped). The
    # caller wraps it into the model's JSONB proof document.
    proof_text: str
    # The declared source (the quoted tweet or a linked post), distinct from
    # ``detected_from_url``. None when the thread neither quoted nor carried
    # exactly one candidate link: a ``detected`` draft may have no source.
    source_url: str | None
    # The post this draft was detected from (the geoloc post): its id is the
    # identity every surface keys on, the URL the provenance link built from it
    # (:func:`urls.canonical_tweet_url`). The id is ``None`` only when an
    # adapter handed over a non-numeric one, which no upstream writes.
    detected_from_tweet_id: int | None
    detected_from_url: str
    # Every post id of the thread this draft was read from, the anchor included
    # and in thread order. The entries anchor differently on one self-thread
    # (the archive stitches it whole, the two live entries read one hop), so
    # this is what lets the write path recognise the same geolocation whichever
    # entry read it. Non-numeric ids are dropped, like the anchor's.
    thread_tweet_ids: tuple[int, ...]
    # Provisional event date = the geoloc tweet's post date; the owner corrects
    # it at submit (the true event usually predates the post). None when the
    # tweet's timestamp is unusable.
    event_date: date | None
    # The source's post instant (UTC), only when actually known (a dated quote
    # or a chased post); never a fallback onto the geoloc tweet's own date.
    source_posted_at: datetime | None
    # When the analyst posted THIS geolocation (the geoloc tweet) → the nullable
    # ``detected_post_at``.
    detected_post_at: datetime | None
    # The mirrors: the candidates the source slot did not take, ordered,
    # normalized and capped (:func:`resolve_secondary_sources`). Prefills the
    # row's secondary source links, which the owner edits at submit.
    secondary_source_urls: list[str] = field(default_factory=list)
    # Footage (role=source, capped at one) vs the analyst's annotation (role=proof).
    source_media: list[ParsedMedia] = field(default_factory=list)
    proof_media: list[ParsedMedia] = field(default_factory=list)
    # What this draft still needs from its owner (the ``*_MISSING`` /
    # ``*_AMBIGUOUS`` / ``SEVERAL_COORDINATES`` constants above). Every draft of
    # one thread carries the same list; the entry surfaces it its own way (the
    # bot's reply, the archive's outcome email).
    warnings: list[str] = field(default_factory=list)


def sole_refusal(refusals: dict[str, int]) -> str | None:
    """The one refusal code to name back to the analyst, or ``None``.

    ``None`` when nothing refused, and when several threads refused for
    different reasons: an export naming one of its refusals would be picking a
    winner, so it reads the counts instead.
    """
    return next(iter(refusals)) if len(refusals) == 1 else None


@dataclass(frozen=True)
class Resolution:
    """What a batch of threads resolves to, the engine's whole answer.

    ``drafts`` are in thread order, and one thread's drafts are contiguous:
    the write path caches a thread's media on that.
    """

    drafts: list[Draft] = field(default_factory=list)
    # How many threads the engine refused, keyed by the refusal constants above.
    # A one-thread entry (the bot, the paste) reads :attr:`reason`; an export
    # refusing several threads reads the counts.
    refusals: dict[str, int] = field(default_factory=dict)

    @property
    def warnings(self) -> dict[str, int]:
        """How many drafts carry each warning, keyed by the warning constants.

        The count is of what the engine read, not of what persisted, so the
        bot's reply and the archive's outcome email read the same numbers.
        """
        counts: dict[str, int] = {}
        for draft in self.drafts:
            for warning in draft.warnings:
                counts[warning] = counts.get(warning, 0) + 1
        return counts

    @property
    def reason(self) -> str | None:
        """The one refusal to name when the batch resolved no draft at all."""
        return None if self.drafts else sole_refusal(self.refusals)


def own_posts(thread: list[TweetRecord]) -> list[TweetRecord]:
    """``thread`` without the retweets: posts carrying someone else's words.

    A retweet's content belongs to another account, so importing one would file
    a stranger's geolocation under the analyst. The rule holds on every entry
    (:func:`extract.is_retweet`); the archive reader also drops them earlier, so
    they never enter its stitching.
    """
    return [record for record in thread if not is_retweet(record.text)]


def _warnings_for(
    coords: list[ParsedCoord], source_url: str | None, mirrors: list[str]
) -> list[str]:
    """What the resolution could not settle, in reply order.

    The source is empty in exactly two cases, and the mirrors tell them apart:
    several candidates all landed there (ambiguous), or there was no candidate
    and no quote at all (missing).
    """
    warnings: list[str] = []
    if len(coords) > 1:
        warnings.append(SEVERAL_COORDINATES)
    if source_url is None:
        warnings.append(SOURCE_AMBIGUOUS if mirrors else SOURCE_MISSING)
    return warnings


def resolve_threads(threads: list[list[TweetRecord]]) -> Resolution:
    """The engine: every thread's drafts, plus one count per refusal code.

    Pure and in memory, so an export resolves in full before the write path
    touches a row, which is what gives its progress callback an exact total.
    Every entry runs it: the bot and the paste over the single thread they
    acquired, the archive backfill over every stitched self-thread of an export.
    """
    drafts: list[Draft] = []
    refusals: dict[str, int] = {}
    for thread in threads:
        found, refusal = _thread_drafts(thread)
        drafts.extend(found)
        if refusal is not None:
            refusals[refusal] = refusals.get(refusal, 0) + 1
    return Resolution(drafts=drafts, refusals=refusals)


def _thread_drafts(thread: list[TweetRecord]) -> tuple[list[Draft], str | None]:
    """One ``Draft`` per coordinate the thread carries, or the reason it carries
    none.

    Two reasons, which is all the engine can tell apart: a coordinate-shaped
    string sat outside the world (``COORDS_INVALID``), or the analyst's own text
    carried no coordinate at all (``COORDS_MISSING``), which also covers a
    thread that is empty or holds only retweets. A thread that produced drafts
    carries no reason; what those drafts still need is on their ``warnings``.
    """
    posts = own_posts(thread)
    if not posts:
        return [], COORDS_MISSING
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
    if not scan.coords:
        return [], COORDS_INVALID if scan.out_of_bounds else COORDS_MISSING
    source_url, source_iso = resolve_source(posts)
    source_media, proof_media = split_media(posts)
    detected_post_at = _posted_at(head.created_at)
    secondary_source_urls = resolve_secondary_sources(posts, source_url)
    # Everything but the coordinate is derived once and shared: the drafts of
    # one thread differ on the coordinate alone.
    title = derive_title(own_text)
    proof_text = clean_proof_text(own_text)
    warnings = _warnings_for(scan.coords, source_url, secondary_source_urls)
    # Every post the thread is made of, not only the anchor: the entries anchor
    # differently on one self-thread, so this is the set the write path
    # recognises a re-import by. The retweets ``own_posts`` dropped are not part
    # of it, since they are not the analyst's thread.
    thread_tweet_ids = tuple(
        tweet_id
        for tweet_id in (_tweet_id(post.tweet_id) for post in posts)
        if tweet_id is not None
    )
    return [
        Draft(
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
            warnings=warnings,
        )
        for coord in scan.coords
    ], None


# A post id is a snowflake, so it fits a signed 64-bit integer by construction
# and the column is a bigint. The bound is still checked: an export is
# attacker-controlled and its reader admits any digit string, and a value past
# this would fail the insert rather than the parse.
_MAX_TWEET_ID = 2**63 - 1


def _tweet_id(raw: str) -> int | None:
    """The head post's id as the ``events`` column holds it, ``None`` when the
    adapter handed over something that is not a post id.

    Both adapters produce digits (the archive rejects anything else outright,
    syndication is fetched by an id that matched ``urls``), so ``None`` is the
    shape no upstream writes rather than a case with behaviour of its own: a
    draft carrying it dedups on its source URL alone.
    """
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if 0 <= value <= _MAX_TWEET_ID else None


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
