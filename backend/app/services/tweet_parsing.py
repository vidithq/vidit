"""Tweet ingestion helpers — URL normalisation, syndication fetch, content parsing.

Backs ``POST /geolocations/import-from-tweet``: paste a tweet URL, get back
structured data to pre-fill the submit form (title, source, posted-at,
media, best-effort coordinates). The analyst always reviews and submits —
nothing auto-publishes.

Data source
-----------

X's public *syndication* endpoint:

    https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>&lang=en

The same backend the embeddable ``<blockquote class="twitter-tweet">``
widget uses — unauthenticated, unofficial, no documented contract; X can
change the schema or move it anytime. The route surfaces failures as `502`
so the frontend shows a "fill the form manually" banner and stays usable
even when this service is fully broken. The ``token`` algorithm is copied
verbatim from Vercel's `react-tweet` (MIT) — a deterministic hash X
requires on every request.

Caching
-------

In-memory TTL cache keyed by tweet ID, 1h. Analysts commonly click "Import"
twice (paste, restart, re-paste); X is rate-sensitive so the second click
shouldn't pay the round trip. Process-local; restarts wipe it — fine, we're
not authoritative storage for tweets.

Coordinate parsing
------------------

Four extractors run over the full text, de-duped:

1. Decimal pairs (``48.012345, 37.802411``)
2. Decimal degrees + hemisphere (``33.1°N 35.5°E``, ``50.4501N, 30.5234E``,
   ``N48.0123 E37.8024`` — ``°`` optional, letter on either side)
3. DMS (``48°00'45"N 37°48'08"E``)
4. Google Maps ``@lat,lng,zoom`` links

The first lands in the form by default; extras become "other candidates"
chips. The decimal-pair extractor requires ≥3 decimal places to avoid
matching dates / version strings (`1.2.3`, `2025-11-12`); the hemisphere and
DMS forms use the directional letters as the discriminator (one fractional
digit suffices); Maps URLs are unambiguous.
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

    Routes turn this into a ``502``: the frontend's "fill the form
    manually" banner doesn't distinguish transport blips from schema drift
    (operationally identical — "retry later or do it by hand").
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
    """Validate a tweet URL and return canonical form + extracted parts.

    Accepts ``x.com`` / ``twitter.com`` (± ``www.``), strips query +
    fragment, reduces the path to ``/<handle>/status/<id>``. Anything else
    (profiles, lists, search, home feed, unrelated host) raises
    ``InvalidTweetUrl``. The handle isn't validated for existence — that's
    the syndication endpoint's 404 → ``TweetNotAccessible``.
    """
    parsed = urlparse(raw.strip())
    if parsed.scheme not in ("http", "https"):
        raise InvalidTweetUrl("Not a tweet URL")
    host = (parsed.hostname or "").lower()
    if host not in _TWITTER_HOSTS:
        raise InvalidTweetUrl("Not a tweet URL")

    # Path shape: /<handle>/status/<id> — also tolerate the older
    # /i/web/status/<id> form some clients emit with no handle context.
    parts = [p for p in parsed.path.split("/") if p]
    tweet_id: str | None = None
    handle: str | None = None
    if len(parts) >= 3 and parts[1] == "status":
        handle = parts[0]
        tweet_id = parts[2]
    elif len(parts) >= 4 and parts[0] == "i" and parts[1] == "web" and parts[2] == "status":
        # /i/web/status/<id> — no handle in the URL. Mark it with the "i"
        # sentinel so the caller sources the real handle from the response;
        # the canonical URL keeps the ``/i/web/status/`` path so a
        # round-trip stays a valid tweet page (``x.com/i/status/<id>`` 404s).
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
# endpoint 404s even for public tweets without this token; it's a
# deterministic hash we can compute locally without an extra round trip.
_TOKEN_MULTIPLIER = math.pi**6


def _syndication_token(tweet_id: str) -> str:
    value = int(tweet_id) * _TOKEN_MULTIPLIER
    # base-36; strip zeros and the decimal point — the JS reference's
    # `/(0+|\.)/g` replace is exactly this.
    encoded = _to_base36(value)
    return re.sub(r"(0+|\.)", "", encoded)


def _to_base36(value: float) -> str:
    """Match JavaScript's ``Number.prototype.toString(36)``.

    JS toString(36) on a float emits the integer part in base36, a `.`, then
    fractional digits. Python only handles the integer side, so we hand-roll
    the fractional side to keep the token byte-identical with `react-tweet`.
    Fractional emission stops at 52 digits (IEEE-754 mantissa bits), matching
    the JS engine's truncation.
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
# Hard cap on cache occupancy. TTL alone only prunes on re-access of the
# same key — a scraper hammering varied IDs through the 30/min/IP limit
# could accumulate ~10k entries before any eviction. 256 covers the
# analyst hot set (clicking Import twice) and bounds worst-case memory.
_CACHE_MAX_ENTRIES = 256


@dataclass
class _CacheEntry:
    value: dict[str, Any]
    expires_at: float


# ``OrderedDict`` so LRU eviction is constant-time ``popitem(last=False)``.
# Move-to-end on every hit + insertion keeps the front least-recently-used.
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

    The optional ``client`` is for tests (a `MockTransport`); production
    never passes it. Returns the parsed JSON body. Raises:

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


# Horizontal whitespace only — a coordinate pair lives on one line. A separator
# that spanned a newline would pair a latitude on one line with a longitude on
# the next, and the per-line proof / title strippers (run over ``splitlines()``)
# wouldn't remove what ``extract_coords`` lifted. Every extractor below uses it.
_HWS = r"[^\S\r\n]"

# Decimal pairs. The `.\d{3,}` floor on both sides keeps us off dates
# (`2025-11-12`), version strings (`1.2.3`), and reply counts — none carry
# 3+ decimals on both numbers at once.
_DECIMAL_PAIR_RE = re.compile(
    r"(?<![\d.])"
    r"([-+]?\d{1,3}\.\d{3,})"
    rf"(?:{_HWS}|,)+"
    r"([-+]?\d{1,3}\.\d{3,})"
    r"(?![\d.])"
)

# Decimal degrees + hemisphere letter. The letter (not a decimal floor) is the
# discriminator — it disambiguates from dates / versions — so one fractional
# digit is enough; ``°`` is optional. Latitude (N/S) first in both orderings,
# matching how OSINT posts write them. Two variants: letter-suffix
# (``33.1°N 35.5°E``, ``50.4501N, 30.5234E``) and letter-prefix
# (``N48.0123 E37.8024``). Lat-first only — lng-first input (``35.5E 33.1N``)
# is intentionally not matched. The inter-half separator is a comma / slash /
# horizontal whitespace (no newline, via ``_HWS``); requiring it is also what
# rejects prose-embedded letters like ``N12.5 area E34.6``.
_DECIMAL_HEMI_SUFFIX_RE = re.compile(
    r"(?<![\w.])"
    r"(\d{1,3}\.\d+)\s*°?\s*([NS])"
    rf"(?:{_HWS}|[,/])+"
    r"(\d{1,3}\.\d+)\s*°?\s*([EW])"
    r"(?![\w.])",
    re.IGNORECASE,
)
_DECIMAL_HEMI_PREFIX_RE = re.compile(
    r"(?<![\w.])"
    r"([NS])\s*(\d{1,3}\.\d+)\s*°?"
    rf"(?:{_HWS}|[,/])+"
    r"([EW])\s*(\d{1,3}\.\d+)\s*°?"
    r"(?![\w.])",
    re.IGNORECASE,
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


def _hemi_decimal(value: str, hemi: str) -> float:
    """Signed decimal degree from a bare number + hemisphere letter."""
    decimal = float(value)
    if hemi.upper() in ("S", "W"):
        decimal = -decimal
    return decimal


def extract_coords(text: str) -> list[ParsedCoord]:
    """Run all extractors over ``text`` and return a de-duped candidate list.

    Order: decimal pairs (most common in OSINT posts), decimal degrees +
    hemisphere, DMS (older intel), then Google Maps URLs. Capped at
    ``_MAX_CANDIDATES`` so a flood of coordinate-shaped strings can't blow up
    the payload.

    Dedup by rounded-to-6-decimals key — finer gives float-equality
    artefacts, coarser conflates candidates the analyst wants distinct.
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

    for m in _DECIMAL_HEMI_SUFFIX_RE.finditer(text):
        _push(_hemi_decimal(m.group(1), m.group(2)), _hemi_decimal(m.group(3), m.group(4)))
        if len(candidates) >= _MAX_CANDIDATES:
            return candidates

    for m in _DECIMAL_HEMI_PREFIX_RE.finditer(text):
        _push(_hemi_decimal(m.group(2), m.group(1)), _hemi_decimal(m.group(4), m.group(3)))
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


# Every coordinate form, for stripping coordinates out of prose (title +
# proof body). The structured ``coordinate`` field is the home for the value;
# leaving it in the text duplicates it and reads as noise.
_COORD_RES = (
    _DECIMAL_PAIR_RE,
    _DECIMAL_HEMI_SUFFIX_RE,
    _DECIMAL_HEMI_PREFIX_RE,
    _DMS_RE,
    _GMAPS_RE,
)


def _strip_coords(text: str) -> str:
    for rx in _COORD_RES:
        text = rx.sub(" ", text)
    return text


# ── Title heuristic ───────────────────────────────────────────────────────


_HASHTAG_RE = re.compile(r"#\w+")
_URL_RE = re.compile(r"https?://\S+")
_WHITESPACE_RE = re.compile(r"\s+")
# A leading list marker: bullet glyphs or an ordinal (``1.`` / ``1)``) at the
# start of a line. Anchored + single-shot so it only peels the marker, not
# digits mid-prose.
_LEADING_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*•·‣–—]|\d{1,3}[.)])\s+")
# A bracket pair emptied by coordinate removal — ``(48.0, 37.8)`` becomes
# ``( )`` after the strip; drop the husk rather than leave it in the title. Only
# matches pairs with no word char inside, so ``(note)`` is left intact.
_EMPTY_BRACKETS_RE = re.compile(r"[(\[{][^\w)\]}]*[)\]}]")
# Edge punctuation left dangling once coords / brackets are gone (a trailing
# ``:`` from ``Coordinates: <coord>``, a stray separator). Stripped from the
# ends only — internal punctuation is untouched.
_TITLE_EDGE_CHARS = " \t:;,.|/-–—()[]{}°"
_HAS_WORD_RE = re.compile(r"\w")
_TITLE_MAX_LEN = 120


def derive_title(text: str) -> str:
    """Best-effort title from the tweet body.

    First usable line — hashtags, URLs, a leading list marker, bare
    coordinates, and the bracket / punctuation husks they leave behind are
    stripped; whitespace is collapsed and the result truncated to
    ``_TITLE_MAX_LEN`` on a word boundary. A line that holds no real word once
    cleaned (coordinates / links / hashtags / punctuation only) is skipped — the
    title is never a bare coordinate. If no line is usable, return ``""`` so the
    analyst types one — a wrong title in the field is worse than none.

    Truncation: prefer the last space inside the limit; with none (one long
    token, e.g. a no-space cyrillic address) hard-cut so the title never
    exceeds the form's column.
    """
    for raw_line in text.splitlines():
        line = _HASHTAG_RE.sub("", raw_line)
        line = _URL_RE.sub("", line)
        line = _LEADING_LIST_MARKER_RE.sub("", line)
        line = _strip_coords(line)
        line = _EMPTY_BRACKETS_RE.sub(" ", line)
        line = _WHITESPACE_RE.sub(" ", line).strip().strip(_TITLE_EDGE_CHARS)
        # Nothing but punctuation / emoji left once the noise is gone — skip it.
        if not line or not _HAS_WORD_RE.search(line):
            continue
        if len(line) <= _TITLE_MAX_LEN:
            return line
        # Last space within the truncation window — slice first then look
        # back (``rsplit`` would find the last space in the whole string).
        clipped = line[:_TITLE_MAX_LEN]
        cut_at = clipped.rfind(" ")
        if cut_at >= 40:  # don't cut so aggressively the title becomes a stub
            return clipped[:cut_at].rstrip()
        return clipped.rstrip()
    return ""


# ── Proof text cleanup ────────────────────────────────────────────────────


# ``t.co`` shortlinks as they appear inline in raw tweet text — X wraps every
# link this way. Only t.co is stripped (not arbitrary URLs): a real source link
# in the body is provenance worth keeping, and the structured source lives
# elsewhere (``source_url`` / ``detected_from_url``).
_T_CO_URL_RE = re.compile(r"https?://t\.co/\S+", re.IGNORECASE)


def clean_proof_text(text: str) -> str:
    """Strip from assembled proof text the artefacts that don't belong in a
    proof body: bare coordinates (the value is a structured field), ``t.co``
    shortlinks (provenance lives in ``source_url`` / ``detected_from_url``),
    and per-line leading list markers. Lines emptied by the removals are
    dropped; internal whitespace is collapsed; lines join with single
    newlines.

    Used by the assemble step when it turns a tweet / thread into a
    detection's proof document — source-agnostic (archive or syndication).
    """
    out_lines: list[str] = []
    for raw_line in text.splitlines():
        line = _strip_coords(raw_line)
        line = _T_CO_URL_RE.sub("", line)
        line = _LEADING_LIST_MARKER_RE.sub("", line)
        line = _WHITESPACE_RE.sub(" ", line).strip()
        if line:
            out_lines.append(line)
    return "\n".join(out_lines)


# ── Media extraction ──────────────────────────────────────────────────────


# Allowlist of hosts the backend will fetch media from. The media-proxy
# route uses the same list — keep them aligned so a hostile tweet payload
# (or X schema change) can't trick the proxy into an arbitrary outbound
# request (SSRF).
TWITTER_MEDIA_HOSTS = frozenset({"pbs.twimg.com", "video.twimg.com"})


@dataclass(frozen=True)
class ParsedMedia:
    kind: Literal["image", "video"]
    remote_url: str
    content_type: str
    # Where this media came from in the payload. The frontend's
    # primary-vs-proof split is by ``kind`` (videos = source footage,
    # images = annotated screenshots), so ``origin`` is informational only
    # (proof-body attribution, debugging, a future smarter split). Don't add
    # consumers that assume one origin maps to one bucket.
    origin: Literal["op", "quote"] = "op"


def is_trusted_media_url(url: str) -> bool:
    """Allowlist check used by both the response builder and the proxy.

    Single source of truth — ``parse_tweet`` (filtering what we advertise)
    and the media-proxy route (validating ``u=`` before opening a socket)
    both call this. Drift would silently drop legitimate media or open the
    proxy to SSRF.
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

    # Images live under ``mediaDetails`` (and the older ``photos`` on some
    # shapes). ``mediaDetails`` is primary — it carries videos too — with
    # ``photos`` as the image-only fallback.
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
                # Highest-bitrate mp4 variant — the quality the embed widget
                # surfaces, which is what the analyst expects in the preview.
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

    In OSINT workflows an analyst geolocating someone else's footage
    quote-tweets the original and attaches annotated screenshots, so the
    quoted tweet is the actual *source* and the OP is just commentary. When
    a quote is detected, the frontend uses the quote URL as ``source_url``
    rather than the OP's (which would credit the analyst, not the source).
    """

    source_url: str
    author_handle: str
    tweet_text: str


_TWITTER_URL_HOST_RE = re.compile(r"^(?:www\.)?(?:x|twitter)\.com$", re.IGNORECASE)
_T_CO_HOST_RE = re.compile(r"^t\.co$", re.IGNORECASE)


def _extract_external_source_url(syndication: dict[str, Any]) -> str | None:
    """First non-X URL from ``entities.urls``, when present.

    OSINT posts commonly put the *real* source as a body link
    (``Source: https://t.me/...``, YouTube / Telegram / Mastodon). We trust
    the embed serialiser's ``expanded_url`` over the wrapped ``t.co``
    shortlink, skipping ``x.com`` / ``twitter.com`` / ``t.co`` so a tagged
    profile or self-reference can't masquerade as a source.

    Returns the first off-platform URL, or ``None`` if all stay on X.
    'First' matches the "Source: <link>" convention.
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

    Returns ``None`` for a top-level tweet or any unrecognised shape —
    never raises. Defensive against schema drift on the unofficial
    endpoint: anything upstream stops emitting degrades to "no quote" and
    the form falls back to the OP URL.
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
    # The SOURCE — the quoted tweet's URL when the OP quote-retweets, else
    # the OP's own. The OP is rarely the real source in OSINT (messenger,
    # not footage source), so the frontend uses this as the ``source_url``
    # form field.
    source_url: str
    # The OP's URL — kept so the frontend can cite the analyst in the proof
    # body even when ``source_url`` points at the quoted source.
    original_tweet_url: str
    posted_at: str  # ISO 8601 UTC
    author_handle: str
    tweet_text: str
    suggested_title: str
    parsed_coords: list[ParsedCoord]
    # All media from the OP + the quoted tweet; each entry's ``origin`` tells
    # the frontend primary (``quote``) vs proof (``op``). See ``ParsedMedia``.
    media: list[ParsedMedia]
    quoted_tweet: ParsedQuotedTweet | None


def parse_tweet(url: str, *, client: httpx.Client | None = None) -> ParsedTweet:
    """Top-level helper used by the route.

    Walks normalise → fetch → extract into a ``ParsedTweet``. The optional
    ``client`` is for tests (an ``httpx.Client`` on a ``MockTransport``).
    """
    normalised = normalise_tweet_url(url)
    body = fetch_syndication(normalised.tweet_id, client=client)

    # Author handle — prefer the response's screen name over the URL's,
    # since `/i/web/status/<id>` has no handle. Fall back to the URL handle
    # if the field is missing (schema-drift defensive).
    user = body.get("user")
    author_handle = normalised.handle
    if isinstance(user, dict):
        screen_name = user.get("screen_name")
        if isinstance(screen_name, str) and screen_name:
            author_handle = screen_name
    if author_handle == "i":
        # Neither the ``/i/web/status/...`` URL nor the response yielded a
        # handle — emit empty; the caller can render "@unknown".
        author_handle = ""

    posted_at_raw = body.get("created_at")
    if not isinstance(posted_at_raw, str) or not posted_at_raw:
        raise TweetFetchFailed("upstream missing created_at")

    tweet_text = body.get("text")
    if not isinstance(tweet_text, str):
        tweet_text = ""

    quoted = _extract_quoted_tweet(body)

    # Coords from the OP text first, falling back to the quoted tweet.
    # Analyst commentary (the OP) usually carries them, but some posts just
    # say "here ↓" and let the quoted source carry them.
    coords = extract_coords(tweet_text)
    if not coords and quoted is not None and quoted.tweet_text:
        coords = extract_coords(quoted.tweet_text)

    # Media split: OP tagged ``op``, quoted tweet tagged ``quote``; the
    # frontend uses ``origin`` for ``files[]`` (primary) vs proof body
    # (annotated screenshots).
    media = list(_extract_media(body, origin="op"))
    if quoted is not None:
        qt_body = body.get("quoted_tweet")
        if isinstance(qt_body, dict):
            media.extend(_extract_media(qt_body, origin="quote"))

    # ``source_url`` resolution, in priority order:
    #
    # 1. Quoted tweet's URL — OP quote-retweeted the source.
    # 2. First non-X URL in ``entities.urls`` — analyst typed it
    #    ("Source: https://t.me/...").
    # 3. OP's own URL — wrong attribution often enough (analysts post their
    #    analysis, not the footage source) that the frontend banner reminds
    #    them to override, but better than a blank form.
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
