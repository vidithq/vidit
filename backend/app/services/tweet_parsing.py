"""Tweet ingestion helpers — URL normalisation, syndication fetch, content parsing.

Backs the ``POST /geolocations/import-from-tweet`` route. The contract is:
"paste a tweet URL, get back enough structured data to pre-fill the submit
form (title, source, posted-at, media, best-effort coordinates)". The
analyst always reviews and submits — nothing here auto-publishes.

Data source
-----------

X's public *syndication* endpoint:

    https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>&lang=en

This is the same backend the embeddable ``<blockquote class="twitter-tweet">``
widget uses; it's unauthenticated and unofficial — there's no documented
contract and X can change the schema or move the endpoint at any time.
Our route surfaces those failures as a `502` so the frontend renders a
"fill the form manually" banner; the form remains usable end-to-end even
when this service is completely broken. The ``token`` algorithm is copied
verbatim from Vercel's `react-tweet` (MIT-licensed) — a deterministic
hash X requires on every request.

Caching
-------

In-memory TTL cache keyed by tweet ID, 1h. Analysts commonly click
"Import" twice in a row (paste URL, realise they want to start over,
re-paste). X is rate-sensitive and we'd rather not pay the network round
trip for the second click. Process-local; restarts wipe it — fine, we're
not authoritative storage for tweets.

Coordinate parsing
------------------

Three extractors run over the full tweet text, results de-duped:

1. Decimal pairs (``48.012345, 37.802411``)
2. DMS (``48°00'45"N 37°48'08"E``)
3. Google Maps ``@lat,lng,zoom`` links

The first by default lands in the form; any extras are surfaced as
"other candidates" chips the analyst can click to swap. The decimal
extractor requires ≥3 decimal places to avoid matching dates / version
strings (`1.2.3`, `2025-11-12`); DMS uses the directional letters as
the discriminator; Maps URLs are unambiguous on their own.
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


# ── Public errors ──────────────────────────────────────────────────────────


class TweetImportError(RuntimeError):
    """Base class for every parse / fetch failure surfaced by this module."""


class InvalidTweetUrl(TweetImportError):
    """The URL the caller provided isn't a tweet URL we can fetch.

    Examples: ``https://example.com``, an X profile page, an X search URL,
    a malformed string. Routes turn this into a ``400``.
    """


class TweetNotAccessible(TweetImportError):
    """The syndication endpoint returned 404 / the tweet is gone / protected.

    Routes turn this into a ``404``.
    """


class TweetFetchFailed(TweetImportError):
    """The syndication endpoint was unreachable / 5xx / schema drift.

    Routes turn this into a ``502`` so the frontend can render a
    graceful "fill the form manually" banner without distinguishing
    transport blips from schema-drift bugs (operationally identical:
    "retry later, or do it by hand").
    """


# ── URL normalisation ─────────────────────────────────────────────────────


_TWEET_ID_PATTERN = re.compile(r"^\d{5,25}$")
_TWITTER_HOSTS = frozenset({"x.com", "www.x.com", "twitter.com", "www.twitter.com"})


@dataclass(frozen=True)
class NormalisedTweetUrl:
    canonical: str  # e.g. "https://x.com/handle/status/1234567890"
    tweet_id: str
    handle: str


def normalise_tweet_url(raw: str) -> NormalisedTweetUrl:
    """Validate the input is a tweet URL and return canonical form + extracted parts.

    Accepts ``x.com`` and ``twitter.com`` (with or without ``www.``), strips
    query string and fragment, and reduces the path to ``/<handle>/status/<id>``.
    Anything that isn't a status URL — profiles, lists, search, the home
    feed, an unrelated host — raises ``InvalidTweetUrl``. The handle is
    not validated for "this account exists"; that's the syndication
    endpoint's job to surface as 404 → ``TweetNotAccessible``.
    """
    parsed = urlparse(raw.strip())
    if parsed.scheme not in ("http", "https"):
        raise InvalidTweetUrl("Not a tweet URL")
    host = (parsed.hostname or "").lower()
    if host not in _TWITTER_HOSTS:
        raise InvalidTweetUrl("Not a tweet URL")

    # Path shape: /<handle>/status/<id> — also tolerate the older
    # /i/web/status/<id> form some clients emit on shares with no
    # handle context.
    parts = [p for p in parsed.path.split("/") if p]
    tweet_id: str | None = None
    handle: str | None = None
    if len(parts) >= 3 and parts[1] == "status":
        handle = parts[0]
        tweet_id = parts[2]
    elif len(parts) >= 4 and parts[0] == "i" and parts[1] == "web" and parts[2] == "status":
        # /i/web/status/<id> — handle is unknown from the URL alone.
        # We mark it as the literal "i" sentinel so the caller knows to
        # source the real handle from the syndication response; the
        # canonical URL preserves the ``/i/web/status/`` path so a
        # round-trip to the input form still lands on a valid tweet
        # page (``x.com/i/status/<id>`` returns 404).
        handle = "i"
        tweet_id = parts[3]
    if tweet_id is None or handle is None:
        raise InvalidTweetUrl("Not a tweet URL")
    if not _TWEET_ID_PATTERN.match(tweet_id):
        raise InvalidTweetUrl("Not a tweet URL")

    if handle == "i":
        canonical = f"https://x.com/i/web/status/{tweet_id}"
    else:
        canonical = f"https://x.com/{handle}/status/{tweet_id}"
    return NormalisedTweetUrl(canonical=canonical, tweet_id=tweet_id, handle=handle)


# ── Syndication fetch ─────────────────────────────────────────────────────


# Copied verbatim from Vercel's `react-tweet` (MIT). The syndication
# endpoint demands this token in addition to the tweet id; without it
# the API responds 404 even for public tweets. It's a deterministic
# hash so we can compute it locally without an extra round trip.
_TOKEN_MULTIPLIER = math.pi**6


def _syndication_token(tweet_id: str) -> str:
    value = int(tweet_id) * _TOKEN_MULTIPLIER
    # base-36 representation; strip leading zeros and any decimal point
    # — the JS reference replaces `/(0+|\.)/g` which is exactly that.
    encoded = _to_base36(value)
    return re.sub(r"(0+|\.)", "", encoded)


def _to_base36(value: float) -> str:
    """Match JavaScript's ``Number.prototype.toString(36)``.

    JS toString(36) on a float emits the integer part in base36, then a
    `.`, then digits derived from the fractional part. Python's
    ``int.__format__`` only handles the integer side; we hand-roll the
    fractional side to keep the output byte-identical with
    `react-tweet`'s reference token. The fractional emission stops at
    52 digits (the IEEE-754 mantissa bit count); that matches the JS
    engine's natural truncation point.
    """
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    int_part = int(value)
    frac_part = value - int_part

    # Integer side.
    if int_part == 0:
        int_str = "0"
    else:
        sign = "-" if int_part < 0 else ""
        n = abs(int_part)
        chars: list[str] = []
        while n > 0:
            chars.append(digits[n % 36])
            n //= 36
        int_str = sign + "".join(reversed(chars))

    if frac_part == 0:
        return int_str

    # Fractional side.
    frac_chars: list[str] = []
    for _ in range(52):
        frac_part *= 36
        digit = int(frac_part)
        frac_chars.append(digits[digit])
        frac_part -= digit
        if frac_part == 0:
            break
    return f"{int_str}.{''.join(frac_chars)}"


_SYNDICATION_ENDPOINT = "https://cdn.syndication.twimg.com/tweet-result"
_HTTP_TIMEOUT_S = 5.0
_USER_AGENT = "vidit-tweet-import/1.0"


# ── In-memory TTL + LRU cache ─────────────────────────────────────────────


_CACHE_TTL_S = 3600.0  # 1h
# Hard upper bound on cache occupancy. The TTL alone would only prune
# on access of the same key — a scraper hammering varied tweet IDs
# through the 30/min/IP rate limit could accumulate ~10k entries in a
# few hours before any natural eviction. 256 is more than enough for
# the analyst-pattern hot set (single analyst clicking Import twice in
# a row, the common case the cache exists for) and keeps the worst
# case memory bounded.
_CACHE_MAX_ENTRIES = 256


@dataclass
class _CacheEntry:
    value: dict[str, Any]
    expires_at: float


# ``OrderedDict`` so the LRU eviction is a constant-time
# ``popitem(last=False)``. Move-to-end on every hit and on every
# insertion makes the front of the dict the least-recently-used.
_cache: OrderedDict[str, _CacheEntry] = OrderedDict()
_cache_lock = threading.Lock()


def _cache_get(tweet_id: str) -> dict[str, Any] | None:
    with _cache_lock:
        entry = _cache.get(tweet_id)
        if entry is None:
            return None
        if entry.expires_at < time.time():
            _cache.pop(tweet_id, None)
            return None
        _cache.move_to_end(tweet_id)
        return entry.value


def _cache_put(tweet_id: str, value: dict[str, Any]) -> None:
    with _cache_lock:
        _cache[tweet_id] = _CacheEntry(value=value, expires_at=time.time() + _CACHE_TTL_S)
        _cache.move_to_end(tweet_id)
        while len(_cache) > _CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)


def _cache_clear() -> None:
    """Wipe the in-memory cache. Called from tests; not part of the
    public route surface."""
    with _cache_lock:
        _cache.clear()


def fetch_syndication(tweet_id: str, *, client: httpx.Client | None = None) -> dict[str, Any]:
    """Fetch the syndication JSON for ``tweet_id``.

    The optional ``client`` knob is used by tests to substitute a
    `MockTransport` — production code never passes it. Returns the
    parsed JSON body on success. Raises:

    * ``TweetNotAccessible`` on 404 / deleted / protected tweets.
    * ``TweetFetchFailed`` on timeout, 5xx, or unparseable response.
    """
    cached = _cache_get(tweet_id)
    if cached is not None:
        return cached

    params = {
        "id": tweet_id,
        "token": _syndication_token(tweet_id),
        "lang": "en",
    }
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}

    try:
        if client is None:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S) as own_client:
                resp = own_client.get(_SYNDICATION_ENDPOINT, params=params, headers=headers)
        else:
            resp = client.get(_SYNDICATION_ENDPOINT, params=params, headers=headers)
    except httpx.HTTPError as exc:
        raise TweetFetchFailed(f"transport error: {exc}") from exc

    if resp.status_code == 404:
        raise TweetNotAccessible("Tweet not accessible")
    if resp.status_code >= 300:
        raise TweetFetchFailed(f"upstream returned {resp.status_code}")

    try:
        body = resp.json()
    except ValueError as exc:
        raise TweetFetchFailed(f"unparseable upstream body: {exc}") from exc
    if not isinstance(body, dict):
        raise TweetFetchFailed("upstream returned non-object body")

    _cache_put(tweet_id, body)
    return body


# ── Coordinate extractors ─────────────────────────────────────────────────


@dataclass(frozen=True)
class ParsedCoord:
    lat: float
    lng: float


# Decimal pairs. The `.\d{3,}` floor on both sides is what keeps us from
# matching dates (`2025-11-12`), version strings (`1.2.3`), and reply
# counts ("1.1k replies, 12, 4 retweets") — none of those carry three or
# more decimals on both numbers simultaneously.
_DECIMAL_PAIR_RE = re.compile(
    r"(?<![\d.])"
    r"([-+]?\d{1,3}\.\d{3,})"
    r"\s*[,\s]\s*"
    r"([-+]?\d{1,3}\.\d{3,})"
    r"(?![\d.])"
)

# DMS — degrees, minutes, seconds + hemisphere letter.
_DMS_RE = re.compile(
    r"(\d{1,3})°\s*(\d{1,2})['’]\s*(\d{1,2}(?:\.\d+)?)?[\"”]?\s*([NS])"
    r"\s*[,\s]?\s*"
    r"(\d{1,3})°\s*(\d{1,2})['’]\s*(\d{1,2}(?:\.\d+)?)?[\"”]?\s*([EW])",
    re.IGNORECASE,
)

# Google Maps `@lat,lng,zoom` segment. Tolerant: zoom is optional.
_GMAPS_RE = re.compile(
    r"(?:google\.[^/\s]+/maps[^\s]*?)@(-?\d+\.\d+),(-?\d+\.\d+)(?:,\d+(?:\.\d+)?z?)?",
    re.IGNORECASE,
)


_MAX_CANDIDATES = 3


def _coord_in_bounds(lat: float, lng: float) -> bool:
    return -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0


def _dms_to_decimal(deg: str, mnt: str, sec: str | None, hemi: str) -> float:
    d = int(deg)
    m = int(mnt)
    s = float(sec) if sec else 0.0
    decimal = d + m / 60.0 + s / 3600.0
    if hemi.upper() in ("S", "W"):
        decimal = -decimal
    return decimal


def extract_coords(text: str) -> list[ParsedCoord]:
    """Run all extractors over ``text`` and return a de-duped list of candidates.

    Order: decimal pairs first (most common in OSINT posts), then DMS
    (older intel + RA reports), then Google Maps URLs (when the analyst
    embeds a Street View / Satellite link). Capped at ``_MAX_CANDIDATES``
    so a malicious / accidental flood of coordinate-shaped strings can't
    blow up the response payload.

    De-duplication is by rounded-to-6-decimals key — finer than that
    just gives us float-equality artefacts; coarser would conflate
    candidates the analyst would want to distinguish in the chips.
    """
    candidates: list[ParsedCoord] = []
    seen: set[tuple[float, float]] = set()

    def _push(lat: float, lng: float) -> None:
        if not _coord_in_bounds(lat, lng):
            return
        key = (round(lat, 6), round(lng, 6))
        if key in seen:
            return
        seen.add(key)
        candidates.append(ParsedCoord(lat=lat, lng=lng))

    for m in _DECIMAL_PAIR_RE.finditer(text):
        try:
            lat, lng = float(m.group(1)), float(m.group(2))
        except ValueError:
            continue
        _push(lat, lng)
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    for m in _DMS_RE.finditer(text):
        try:
            lat = _dms_to_decimal(m.group(1), m.group(2), m.group(3), m.group(4))
            lng = _dms_to_decimal(m.group(5), m.group(6), m.group(7), m.group(8))
        except ValueError:
            continue
        _push(lat, lng)
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    for m in _GMAPS_RE.finditer(text):
        try:
            lat, lng = float(m.group(1)), float(m.group(2))
        except ValueError:
            continue
        _push(lat, lng)
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    return candidates


# ── Title heuristic ───────────────────────────────────────────────────────


_HASHTAG_RE = re.compile(r"#\w+")
_URL_RE = re.compile(r"https?://\S+")
_WHITESPACE_RE = re.compile(r"\s+")
_TITLE_MAX_LEN = 120


def derive_title(text: str) -> str:
    """Best-effort title from the tweet body.

    First non-empty line, leading hashtags + URLs stripped, collapsed
    whitespace, truncated to ``_TITLE_MAX_LEN`` on a word boundary. If
    nothing usable remains (empty tweet, all-hashtags, all-URLs), return
    ``""`` so the form leaves the title input empty and the analyst types
    one — that's the right fallback, since the wrong title in the field
    is worse than no title.

    Truncation: prefer the last space-boundary inside the limit; if none
    found (one very long token, e.g. a paste of an arabic / cyrillic
    address with no spaces), hard-cut at the limit so we never emit a
    title longer than the form's column.
    """
    for raw_line in text.splitlines():
        line = _HASHTAG_RE.sub("", raw_line)
        line = _URL_RE.sub("", line)
        line = _WHITESPACE_RE.sub(" ", line).strip()
        if not line:
            continue
        if len(line) <= _TITLE_MAX_LEN:
            return line
        # Word-boundary cut. ``rsplit`` would split on the last space
        # in the entire string; we want the last space within the
        # truncation window, so slice first then look back.
        clipped = line[:_TITLE_MAX_LEN]
        cut_at = clipped.rfind(" ")
        if cut_at >= 40:  # don't cut so aggressively the title becomes a stub
            return clipped[:cut_at].rstrip()
        return clipped.rstrip()
    return ""


# ── Media extraction ──────────────────────────────────────────────────────


# Allowlist of the only hosts our backend will fetch media from. The
# media-proxy route uses the same list — keep them aligned so a hostile
# tweet payload (or a future schema change at X) can't trick the proxy
# into making an arbitrary outbound request.
TWITTER_MEDIA_HOSTS = frozenset({"pbs.twimg.com", "video.twimg.com"})


@dataclass(frozen=True)
class ParsedMedia:
    kind: Literal["image", "video"]
    remote_url: str
    content_type: str
    # Where this media came from inside the syndication payload. The
    # frontend's actual primary-vs-proof split is by ``kind`` — videos
    # are the source footage, images are the analyst's annotated
    # screenshots — so ``origin`` is informational only (used in the
    # proof-body attribution, for debugging, and so a future smarter
    # split can read it without a re-fetch). Don't introduce new
    # consumers that assume one origin maps to one bucket.
    origin: Literal["op", "quote"] = "op"


def is_trusted_media_url(url: str) -> bool:
    """Whitelist check used by both the response builder and the proxy.

    Single source of truth — both ``parse_tweet`` (filtering what we
    advertise to the caller) and the media-proxy route (validating
    the ``u=`` query before opening an outbound socket) call this.
    Drift here would either silently drop legitimate media or open
    the proxy to SSRF.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https":
        return False
    return (parsed.hostname or "").lower() in TWITTER_MEDIA_HOSTS


def _extract_media(
    syndication: dict[str, Any],
    *,
    origin: Literal["op", "quote"] = "op",
) -> list[ParsedMedia]:
    media: list[ParsedMedia] = []

    # Image attachments live under ``mediaDetails`` (and the older
    # ``photos`` field on some response shapes). We treat ``mediaDetails``
    # as primary — it carries video entries too — and fall back to
    # ``photos`` for image-only tweets.
    details = syndication.get("mediaDetails")
    if isinstance(details, list):
        for entry in details:
            if not isinstance(entry, dict):
                continue
            etype = entry.get("type")
            if etype == "photo":
                url = entry.get("media_url_https")
                if isinstance(url, str) and is_trusted_media_url(url):
                    media.append(
                        ParsedMedia(
                            kind="image",
                            remote_url=url,
                            content_type="image/jpeg",
                            origin=origin,
                        )
                    )
            elif etype in ("video", "animated_gif"):
                # Pick the highest-bitrate mp4 variant — that's the
                # quality the embed widget surfaces, which is also the
                # one the analyst expects to see in the form's preview.
                variants = entry.get("video_info", {}).get("variants", [])
                best: dict[str, Any] | None = None
                if isinstance(variants, list):
                    for v in variants:
                        if not isinstance(v, dict):
                            continue
                        if v.get("content_type") != "video/mp4":
                            continue
                        if best is None or (v.get("bitrate", 0) or 0) > (
                            best.get("bitrate", 0) or 0
                        ):
                            best = v
                if best is not None and isinstance(best.get("url"), str):
                    url = best["url"]
                    if is_trusted_media_url(url):
                        media.append(
                            ParsedMedia(
                                kind="video",
                                remote_url=url,
                                content_type="video/mp4",
                                origin=origin,
                            )
                        )

    if not media:
        photos = syndication.get("photos")
        if isinstance(photos, list):
            for entry in photos:
                if not isinstance(entry, dict):
                    continue
                url = entry.get("url")
                if isinstance(url, str) and is_trusted_media_url(url):
                    media.append(
                        ParsedMedia(
                            kind="image",
                            remote_url=url,
                            content_type="image/jpeg",
                            origin=origin,
                        )
                    )

    return media


@dataclass(frozen=True)
class ParsedQuotedTweet:
    """The tweet quoted by the OP, when present.

    In OSINT workflows, when an analyst geolocates someone else's
    footage they typically quote-tweet the original, attach annotated
    screenshots, and tag credibility accounts. From the platform's
    point of view, the quoted tweet is the actual *source* of the
    evidence — the OP is just the analyst's commentary. So when we
    detect a quote, the route surfaces it separately and the frontend
    treats the quote URL as the geolocation's ``source_url`` rather
    than the OP's URL (which would credit the analyst, not the source).
    """

    source_url: str
    author_handle: str
    tweet_text: str


_TWITTER_URL_HOST_RE = re.compile(r"^(?:www\.)?(?:x|twitter)\.com$", re.IGNORECASE)
_T_CO_HOST_RE = re.compile(r"^t\.co$", re.IGNORECASE)


def _extract_external_source_url(syndication: dict[str, Any]) -> str | None:
    """First non-X URL from ``entities.urls``, when present.

    OSINT posts commonly include the *real* source as a plain link in
    the body — ``Source: https://t.me/<channel>/<id>``, or a YouTube /
    Telegram / Mastodon URL. The X embed serialiser expands these via
    ``entities.urls[].expanded_url``, which we trust over the wrapped
    ``t.co`` shortlink. Skips ``x.com`` / ``twitter.com`` / ``t.co``
    hosts so a tagged-account profile link or self-reference doesn't
    masquerade as a source.

    Returns the first URL the analyst typed that points off-platform;
    ``None`` if every URL in the tweet stays on X. The 'first' choice
    matches the OSINT convention of "Source: <link>" being the
    first non-cosmetic URL in the body.
    """
    entities = syndication.get("entities")
    if not isinstance(entities, dict):
        return None
    urls = entities.get("urls")
    if not isinstance(urls, list):
        return None
    for entry in urls:
        if not isinstance(entry, dict):
            continue
        expanded = entry.get("expanded_url")
        if not isinstance(expanded, str) or not expanded:
            continue
        try:
            parsed = urlparse(expanded)
        except ValueError:
            continue
        host = (parsed.hostname or "").lower()
        if not host:
            continue
        if _TWITTER_URL_HOST_RE.match(host) or _T_CO_HOST_RE.match(host):
            continue
        return expanded
    return None


def _extract_quoted_tweet(syndication: dict[str, Any]) -> ParsedQuotedTweet | None:
    """Pull out the quoted-tweet attribution, when the OP quote-retweets.

    Returns ``None`` for a top-level original tweet or any shape we
    don't recognise — never raises. Defensive against schema drift on
    the unofficial endpoint: anything the upstream stops emitting
    quietly degrades to "no quote detected" and the form falls back
    to the OP URL as the source.
    """
    qt = syndication.get("quoted_tweet")
    if not isinstance(qt, dict):
        return None
    tweet_id = qt.get("id_str")
    user = qt.get("user")
    if not isinstance(tweet_id, str) or not isinstance(user, dict):
        return None
    handle = user.get("screen_name")
    if not isinstance(handle, str) or not handle:
        return None
    raw_text = qt.get("text")
    text: str = raw_text if isinstance(raw_text, str) else ""
    return ParsedQuotedTweet(
        source_url=f"https://x.com/{handle}/status/{tweet_id}",
        author_handle=handle,
        tweet_text=text,
    )


# ── End-to-end ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ParsedTweet:
    # ``source_url`` is the SOURCE — the quoted tweet's URL when the OP
    # quote-retweets, otherwise the OP's own URL. The OP URL is rarely
    # the real source in OSINT workflows (the analyst is the messenger,
    # not the source of the footage), so the frontend uses this directly
    # as the ``source_url`` form field.
    source_url: str
    # ``original_tweet_url`` is the OP's URL — kept so the frontend can
    # cite the analyst in the proof body even when ``source_url`` points
    # at the quoted source.
    original_tweet_url: str
    posted_at: str  # ISO 8601 UTC
    author_handle: str
    tweet_text: str
    suggested_title: str
    parsed_coords: list[ParsedCoord]
    # All media from both the OP and the quoted tweet. The ``origin``
    # field on each entry tells the frontend whether it's primary
    # (``quote``) or proof (``op``). See ``ParsedMedia.origin``.
    media: list[ParsedMedia]
    quoted_tweet: ParsedQuotedTweet | None


def parse_tweet(url: str, *, client: httpx.Client | None = None) -> ParsedTweet:
    """Top-level helper used by the route.

    Walks normalise → fetch → extract and returns a fully-populated
    ``ParsedTweet``. The optional ``client`` parameter is for the test
    suite (passes an ``httpx.Client`` wired to a ``MockTransport``).
    """
    normalised = normalise_tweet_url(url)
    body = fetch_syndication(normalised.tweet_id, client=client)

    # Author handle — prefer the screen name from the response over the
    # one we parsed from the URL, since `/i/web/status/<id>` URLs have
    # no handle context. Fall back to the URL handle if the response
    # is missing the field (defensive against schema drift).
    user = body.get("user")
    author_handle = normalised.handle
    if isinstance(user, dict):
        screen_name = user.get("screen_name")
        if isinstance(screen_name, str) and screen_name:
            author_handle = screen_name
    if author_handle == "i":
        # ``/i/web/status/...`` couldn't yield a handle, and the
        # response didn't either — emit empty and let the caller
        # render "@unknown" if they need to.
        author_handle = ""

    posted_at_raw = body.get("created_at")
    if not isinstance(posted_at_raw, str) or not posted_at_raw:
        raise TweetFetchFailed("upstream missing created_at")

    tweet_text = body.get("text")
    if not isinstance(tweet_text, str):
        tweet_text = ""

    quoted = _extract_quoted_tweet(body)

    # Try coordinate extraction on the OP text first; fall back to the
    # quoted tweet's text if the OP has no recognised coords. Real
    # OSINT posts most commonly carry the coordinates in the analyst's
    # commentary (the OP), but a fair number just say "here ↓" and let
    # the quoted source carry them.
    coords = extract_coords(tweet_text)
    if not coords and quoted is not None and quoted.tweet_text:
        coords = extract_coords(quoted.tweet_text)

    # Media split: OP's media tagged ``op``, quoted tweet's tagged
    # ``quote``. The frontend uses ``origin`` to decide which goes into
    # ``files[]`` (primary) vs the proof body (analyst-annotated
    # screenshots).
    media = list(_extract_media(body, origin="op"))
    if quoted is not None:
        qt_body = body.get("quoted_tweet")
        if isinstance(qt_body, dict):
            media.extend(_extract_media(qt_body, origin="quote"))

    # ``source_url`` resolution, in priority order:
    #
    # 1. Quoted tweet's URL — OP quote-retweeted the source.
    # 2. First non-X URL in ``entities.urls`` — analyst typed the source
    #    explicitly in the body ("Source: https://t.me/...").
    # 3. OP's own URL as fallback. This is the wrong attribution often
    #    enough (analysts post their geolocation work as the source of
    #    the analysis, not the source of the footage) that the
    #    frontend banner reminds them to override; but it's a strict
    #    improvement over leaving the form blank.
    if quoted is not None:
        source_url = quoted.source_url
    else:
        external = _extract_external_source_url(body)
        source_url = external if external is not None else normalised.canonical

    return ParsedTweet(
        source_url=source_url,
        original_tweet_url=normalised.canonical,
        posted_at=posted_at_raw,
        author_handle=author_handle,
        tweet_text=tweet_text,
        suggested_title=derive_title(tweet_text),
        parsed_coords=coords,
        media=media,
        quoted_tweet=quoted,
    )
