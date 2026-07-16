"""X I/O — URL normalisation, syndication fetch, schema mappers.

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
"""

from __future__ import annotations

import math
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

from .errors import InvalidTweetUrl, TweetFetchFailed, TweetNotAccessible

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


# ── Media extraction ──────────────────────────────────────────────────────


# Allowlist of hosts the backend will fetch media from. The media-proxy
# route uses the same list — keep them aligned so a hostile tweet payload
# (or X schema change) can't trick the proxy into an arbitrary outbound
# request (SSRF).
TWITTER_MEDIA_HOSTS = frozenset({"pbs.twimg.com", "video.twimg.com"})

# Registrable bases Telegram serves footage from: its own CDN (the apex
# ``cdn-telegram.org`` plus its ``cdnN.cdn-telegram.org`` shards) and
# ``telesco.pe``. Matched by strict dot-boundary suffix (see
# :func:`_host_matches_base`), never a substring, so a look-alike like
# ``evil-cdn-telegram.org`` is rejected.
TELEGRAM_MEDIA_BASE_HOSTS = frozenset({"cdn-telegram.org", "telesco.pe"})

# Byte cap on a single remote-media fetch, shared by every path that streams an
# allowlisted CDN URL into memory: the media-proxy route and the archive /
# Telegram chase (``archive._fetch_cdn_media``). Sized for the upload ceilings
# (10 MB image / 100 MB video) plus HTTP-framing overhead. Anything bigger is an
# unexpected upstream response or a hostile content-length lie; cap and bail so a
# fetch can't buffer an unbounded stream in memory.
MEDIA_FETCH_MAX_BYTES = 110 * 1024 * 1024


def _host_matches_base(host: str, base: str) -> bool:
    """Whether ``host`` is ``base`` itself or a subdomain of it.

    A dot-boundary suffix test, not a substring: ``cdn4.cdn-telegram.org``
    matches ``cdn-telegram.org`` while ``evil-cdn-telegram.org`` (shares the
    trailing string but not the ``.`` boundary) does not.
    """
    return host == base or host.endswith("." + base)


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

    Single source of truth: ``parse_tweet`` (filtering what we advertise), the
    archive / Telegram chases (before fetching a CDN media), and the media-proxy
    route (validating ``u=`` before opening a socket) all call this. Drift would
    silently drop legitimate media or open the proxy to SSRF. Admits the X CDN
    (``TWITTER_MEDIA_HOSTS``, exact) and the Telegram CDN
    (``TELEGRAM_MEDIA_BASE_HOSTS``, strict dot-boundary suffix so a look-alike
    host can't slip through), ``https`` only.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    if host in TWITTER_MEDIA_HOSTS:
        return True
    return any(_host_matches_base(host, base) for base in TELEGRAM_MEDIA_BASE_HOSTS)


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
_YOUTUBE_HOST_RE = re.compile(r"^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$", re.IGNORECASE)
_TELEGRAM_HOST_RE = re.compile(r"^(?:www\.)?t\.me$", re.IGNORECASE)

# A tweet status path: ``/<handle>/status/<id>`` or the handle-less
# ``/i/web/status/<id>``. Single source of truth for "this X link is footage":
# a profile link (no ``/status/``) is not chaseable footage, only a status is.
# ``archive._sole_linked_x_status`` reuses this same pattern to extract the id,
# and ``resolve._status_link_handle`` reuses it to extract the handle.
_X_STATUS_URL_RE = re.compile(
    r"(?:x|twitter)\.com/(?:\w+/status|i/web/status)/(\d+)", re.IGNORECASE
)


def classify_source_host(url: str) -> str:
    """Coarse host class for a source URL: ``x`` / ``telegram`` / ``youtube`` /
    ``other``. Drives whether the footage is retrievable (X, chaseable) or
    off-platform (Telegram / YouTube, link only).

    An X host only classifies as ``x`` when the path is a status
    (``_X_STATUS_URL_RE``): a bare profile link is not footage, so it falls
    through to ``other`` like any unrelated link.
    """
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return "other"
    if _TWITTER_URL_HOST_RE.match(host):
        return "x" if _X_STATUS_URL_RE.search(url) else "other"
    if _TELEGRAM_HOST_RE.match(host):
        return "telegram"
    if _YOUTUBE_HOST_RE.match(host):
        return "youtube"
    return "other"


def extract_source_links(syndication: dict[str, Any]) -> list[tuple[str, str]]:
    """Every expanded, host-classified source URL from ``entities.urls``.

    The analyst's ``Source: <url>`` links. Skips the ``t.co`` wrapper (we trust
    ``expanded_url``) and de-dupes, preserving order. Keeps X status links (a
    status is a chaseable source; a bare profile link is not).
    """
    entities = syndication.get("entities")
    urls = entities.get("urls") if isinstance(entities, dict) else None
    if not isinstance(urls, list):
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for entry in urls:
        if not isinstance(entry, dict):
            continue
        expanded = entry.get("expanded_url")
        if not isinstance(expanded, str) or not expanded or expanded in seen:
            continue
        try:
            host = (urlparse(expanded).hostname or "").lower()
        except ValueError:
            continue
        if _T_CO_HOST_RE.match(host):
            continue
        seen.add(expanded)
        out.append((expanded, classify_source_host(expanded)))
    return out
