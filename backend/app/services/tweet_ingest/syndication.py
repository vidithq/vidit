"""X I/O: the syndication fetch, its cache, and the payload mappers.

Data source
-----------

X's public *syndication* endpoint:

    https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>&lang=en

The same backend the embeddable ``<blockquote class="twitter-tweet">``
widget uses: unauthenticated, unofficial, no documented contract; X can
change the schema or move it anytime. The paste route surfaces failures as a
`502` naming the upstream, so the rest of the app stays usable even when this
service is fully broken. The ``token`` algorithm is copied verbatim from
Vercel's `react-tweet` (MIT), a deterministic hash X requires on every request.

Fetch and payload reading only. What a URL *means* is
:mod:`tweet_ingest.urls`, and what a media *is* is
:class:`tweet_ingest.records.ParsedMedia`, so the pure bricks read that
vocabulary without importing this module.

Caching
-------

In-memory TTL cache keyed by tweet ID, 1h. Analysts commonly click "Import"
twice (paste, restart, re-paste); X is rate-sensitive so the second click
shouldn't pay the round trip. Process-local; restarts wipe it, which is fine:
we're not authoritative storage for tweets.
"""

from __future__ import annotations

import math
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from .errors import TweetFetchFailed, TweetNotAccessible, TweetUpstreamBusy
from .records import MediaKind, ParsedMedia
from .urls import T_CO_HOST_RE, hostname, is_trusted_media_url

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

    * ``TweetNotAccessible`` on 404 / deleted / protected / restricted
      (a ``TweetTombstone`` body) tweets.
    * ``TweetUpstreamBusy`` on a 429 or an X 5xx, the throttled / wobbling
      upstream the route answers ``503``.
    * ``TweetFetchFailed`` on timeout, any other non-2xx, or a body we can't
      use (unparseable, non-object, empty, unknown ``__typename``).
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
    # Throttling and an X-side wobble are their own failure, ahead of the
    # catch-all below: the budget is unauthenticated and shared, so a 429 is an
    # expected outcome that says "retry", not "the payload changed shape".
    if resp.status_code == 429 or resp.status_code >= 500:
        raise TweetUpstreamBusy(f"upstream returned {resp.status_code}")
    if resp.status_code >= 300:
        raise TweetFetchFailed(f"upstream returned {resp.status_code}")

    try:
        body = resp.json()
    except ValueError as exc:
        raise TweetFetchFailed(f"unparseable upstream body: {exc}") from exc
    if not isinstance(body, dict):
        raise TweetFetchFailed("upstream returned non-object body")

    # An exactly-empty object is how X answers a request whose ``token`` it
    # rejected, and the token is computed locally (``_syndication_token``): an
    # empty body means the algorithm no longer matches X's, so tweet import is
    # down for everyone, not drifting on one field. Its own message so the
    # Sentry issue title says which hypothesis to check first.
    if not body:
        raise TweetFetchFailed("upstream returned an empty body, token rejected")

    typename = body.get("__typename")

    # A tombstone is a 200 carrying no tweet: X answers this for a tweet only
    # readable behind a login (age-restricted, withheld in a jurisdiction). The
    # ``tombstone`` object may be empty or carry a human string under
    # ``tombstone.text.text``, so only ``__typename`` is trusted. Raised before
    # ``_cache_put`` on purpose: the restriction can be lifted upstream, and a
    # cached tombstone would keep answering "not readable" for an hour after.
    if typename == "TweetTombstone":
        raise TweetNotAccessible(
            "Post not readable without an X login (age-restricted or withheld)"
        )

    # Any other named shape is a case this module has never seen. It stays a
    # ``TweetFetchFailed`` (the 502 that alerts an operator, which is the whole
    # point of not mapping unknown shapes to a 404), and it carries the value X
    # sent so the Sentry issue title names the shape instead of needing a
    # manual repro. A body with no ``__typename`` at all passes: the field is
    # X's addition, and the mappers below read fields, not the discriminator.
    if isinstance(typename, str) and typename != "Tweet":
        raise TweetFetchFailed(f"upstream returned __typename {typename!r}, not a tweet")

    _cache_put(tweet_id, body)
    return body


# ── Payload mappers ───────────────────────────────────────────────────────


def _bitrate(variant: dict[str, Any]) -> int:
    """A variant's bitrate as an int; an export serialises it as a string."""
    try:
        return int(variant.get("bitrate") or 0)
    except (TypeError, ValueError):
        return 0


def _best_mp4_url(entry: dict[str, Any]) -> str | None:
    """The highest-bitrate mp4 variant a video entry declares, or ``None``.

    The quality the embed widget serves, which is what the analyst expects in
    the preview, and the same one the export saved to disk.
    """
    info = entry.get("video_info")
    variants = info.get("variants") if isinstance(info, dict) else None
    if not isinstance(variants, list):
        return None
    best: dict[str, Any] | None = None
    for variant in variants:
        if not isinstance(variant, dict) or variant.get("content_type") != "video/mp4":
            continue
        if not isinstance(variant.get("url"), str) or not variant["url"]:
            continue
        if best is None or _bitrate(variant) > _bitrate(best):
            best = variant
    return str(best["url"]) if best is not None else None


def media_entry(entry: Any) -> tuple[MediaKind, str] | None:
    """One media entry's kind and the URL it declares, ``None`` when unusable.

    The one reader of a media entry, for the two payload shapes the ingestion
    sees. Past their container key (``mediaDetails`` in a syndication body,
    ``extended_entities.media`` in an export entry) the two spell an entry the
    same: ``type``, plus ``media_url_https`` for a photo and
    ``video_info.variants`` for a video or an animated gif.

    What the URL is *for* stays the caller's business: a live path fetches it
    from the CDN, the export reader keeps its basename and reads the file the
    export saved under that name. An unknown type, a photo with no URL and a
    video with no usable mp4 variant all read as ``None``.
    """
    if not isinstance(entry, dict):
        return None
    if entry.get("type") == "photo":
        url = entry.get("media_url_https")
        return ("image", url) if isinstance(url, str) and url else None
    if entry.get("type") not in ("video", "animated_gif"):
        return None
    mp4 = _best_mp4_url(entry)
    return ("video", mp4) if mp4 is not None else None


def _cdn_media(kind: MediaKind, url: str, origin: Literal["op", "quote"]) -> ParsedMedia:
    """One media the live paths fetch straight from the X CDN."""
    return ParsedMedia(kind=kind, remote_url=url, origin=origin)


def extract_media(
    syndication: dict[str, Any],
    *,
    origin: Literal["op", "quote"] = "op",
) -> list[ParsedMedia]:
    """The media a syndication body carries, as CDN URLs on trusted hosts.

    ``mediaDetails`` is primary, since it carries videos too; the older
    ``photos`` is the image-only fallback some shapes serve instead.

    Public because two modules outside this one read a syndication body: the
    acquisition (:mod:`acquire`) for the post and its inline quote, and the X
    chaser (:mod:`chase.x`) for the post a footage link names.
    """
    details = syndication.get("mediaDetails")
    media = [
        _cdn_media(*read, origin)
        for entry in (details if isinstance(details, list) else [])
        if (read := media_entry(entry)) is not None and is_trusted_media_url(read[1])
    ]
    if media:
        return media
    photos = syndication.get("photos")
    return [
        _cdn_media("image", url, origin)
        for entry in (photos if isinstance(photos, list) else [])
        if isinstance(entry, dict)
        and isinstance(url := entry.get("url"), str)
        and is_trusted_media_url(url)
    ]


def extract_source_links(syndication: dict[str, Any]) -> list[tuple[str, str | None]]:
    """Every URL the post links, from ``entities.urls``, as
    ``(expanded_url, shortlink)`` pairs.

    Host-blind: which of these links can be a source is the resolution's rule,
    not this adapter's. Resolves through ``expanded_url`` (never a bare ``t.co``
    target) and de-dupes, preserving order. ``shortlink`` is the entity's
    ``url`` field, the ``t.co`` token as it sits in the raw text, which is what
    expands the link back to a readable URL in the proof; ``None`` when absent.
    """
    entities = syndication.get("entities")
    urls = entities.get("urls") if isinstance(entities, dict) else None
    if not isinstance(urls, list):
        return []
    out: list[tuple[str, str | None]] = []
    seen: set[str] = set()
    for entry in urls:
        if not isinstance(entry, dict):
            continue
        expanded = entry.get("expanded_url")
        if not isinstance(expanded, str) or not expanded or expanded in seen:
            continue
        if T_CO_HOST_RE.match(hostname(expanded)):
            continue
        seen.add(expanded)
        wrapper = entry.get("url")
        out.append((expanded, wrapper if isinstance(wrapper, str) and wrapper else None))
    return out
