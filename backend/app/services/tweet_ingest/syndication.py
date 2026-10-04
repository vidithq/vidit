"""X I/O: the syndication fetch, its cache, and the payload mappers.

Endpoint: ``https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>&lang=en``,
the backend of the embeddable tweet widget. It is unauthenticated and
unofficial, and X can change the schema anytime. The paste route surfaces
failures as a `502`. The ``token`` algorithm is copied from Vercel's
`react-tweet` (MIT), a deterministic hash X requires on every request.

Fetch and payload reading only; URL meaning is :mod:`tweet_ingest.urls`.

Cache: in-memory TTL (1h) keyed by tweet ID, so a repeated "Import" click skips
the round trip. Process-local; restarts wipe it.
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

from .errors import (
    TweetFetchFailed,
    TweetNotAccessible,
    TweetUpstreamBusy,
    TweetUpstreamUnreachable,
)
from .records import MediaKind, ParsedMedia
from .retry import parse_retry_after, retrying
from .urls import T_CO_HOST_RE, hostname, is_trusted_media_url

# From `react-tweet` (MIT). The endpoint 404s even public tweets without the token.
_TOKEN_MULTIPLIER = math.pi**6


def _syndication_token(tweet_id: str) -> str:
    value = int(tweet_id) * _TOKEN_MULTIPLIER
    # Base 36, zeros and the point stripped, as the JS reference's `/(0+|\.)/g`.
    encoded = _to_base36(value)
    return re.sub(r"(0+|\.)", "", encoded)


def _to_base36(value: float) -> str:
    """Match JavaScript's ``Number.prototype.toString(36)`` on a float.

    Python has no fractional base 36, so the fractional side is hand-rolled to
    keep the token identical to `react-tweet`. It stops at 52 digits (mantissa
    bits), as the JS engine does.
    """
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    int_part = int(value)
    frac_part = value - int_part

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


_CACHE_TTL_S = 3600.0  # 1h
# Hard cap: TTL alone prunes only on re-access, so a scraper varying IDs could
# accumulate ~10k entries. 256 covers the analyst hot set.
_CACHE_MAX_ENTRIES = 256


@dataclass
class _CacheEntry:
    value: dict[str, Any]
    expires_at: float


# Moved to the end on every hit and insert, so the front is least recently used.
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
    """Wipe the in-memory cache (tests)."""
    with _cache_lock:
        _cache.clear()


def fetch_syndication(tweet_id: str, *, client: httpx.Client | None = None) -> dict[str, Any]:
    """Fetch the syndication JSON for ``tweet_id``.

    ``client`` is for tests (a `MockTransport`). Raises:

    * ``TweetNotAccessible`` on 404 or a ``TweetTombstone`` body.
    * ``TweetUpstreamBusy`` on a 429 or an X 5xx (the route answers ``503``).
    * ``TweetUpstreamUnreachable`` on a timeout or transport error, and
      ``TweetFetchFailed`` on any other non-2xx or an unusable body.

    Busy and unreachable upstreams are retried (:mod:`tweet_ingest.retry`); the
    cache sits outside the retried round trip.
    """
    cached = _cache_get(tweet_id)
    if cached is not None:
        return cached
    body = retrying(lambda: _read_syndication(tweet_id, client=client), what=f"tweet {tweet_id}")
    _cache_put(tweet_id, body)
    return body


def _read_syndication(tweet_id: str, *, client: httpx.Client | None) -> dict[str, Any]:
    """One round trip, mapped to a body or a raise; the unit
    :func:`fetch_syndication` retries (no cache access)."""
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
        raise TweetUpstreamUnreachable(f"transport error: {exc}") from exc

    if resp.status_code == 404:
        raise TweetNotAccessible("Tweet not accessible")
    # Ahead of the catch-all: a 429 says "retry", not "the payload changed shape".
    if resp.status_code == 429 or resp.status_code >= 500:
        raise TweetUpstreamBusy(
            f"upstream returned {resp.status_code}",
            retry_after=parse_retry_after(resp.headers.get("Retry-After")),
        )
    if resp.status_code >= 300:
        raise TweetFetchFailed(f"upstream returned {resp.status_code}")

    try:
        body = resp.json()
    except ValueError as exc:
        raise TweetFetchFailed(f"unparseable upstream body: {exc}") from exc
    if not isinstance(body, dict):
        raise TweetFetchFailed("upstream returned non-object body")

    # X answers a rejected ``token`` with an empty object: the local algorithm no
    # longer matches, so import is down for everyone. Own message for the Sentry title.
    if not body:
        raise TweetFetchFailed("upstream returned an empty body, token rejected")

    typename = body.get("__typename")

    # A tombstone is a 200 with no tweet (login-only). Only ``__typename`` is
    # trusted. The raise skips ``_cache_put`` on purpose: a restriction can be
    # lifted, and a cached tombstone would linger for an hour.
    if typename == "TweetTombstone":
        raise TweetNotAccessible(
            "Post not readable without an X login (age-restricted or withheld)"
        )

    # An unseen shape stays a ``TweetFetchFailed`` (the 502 that alerts an
    # operator, not a 404) and carries X's value for the Sentry title. A body
    # with no ``__typename`` passes: the mappers read fields, not the discriminator.
    if isinstance(typename, str) and typename != "Tweet":
        raise TweetFetchFailed(f"upstream returned __typename {typename!r}, not a tweet")

    return body


def _bitrate(variant: dict[str, Any]) -> int:
    """A variant's bitrate as an int; an export serialises it as a string."""
    try:
        return int(variant.get("bitrate") or 0)
    except (TypeError, ValueError):
        return 0


def _best_mp4_url(entry: dict[str, Any]) -> str | None:
    """The highest-bitrate mp4 variant a video entry declares, or ``None``
    (the quality the widget serves and the export saved)."""
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
    """One media entry's kind and declared URL, ``None`` when unusable.

    The one reader of a media entry for both payload shapes (``mediaDetails``
    in syndication, ``extended_entities.media`` in an export): ``type`` plus
    ``media_url_https`` for a photo, ``video_info.variants`` for a video or gif.
    An unknown type, a URL-less photo and a video with no mp4 read as ``None``.
    What the URL is for stays the caller's business.
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
    """One media fetched straight from the X CDN."""
    return ParsedMedia(kind=kind, remote_url=url, origin=origin)


def extract_media(
    syndication: dict[str, Any],
    *,
    origin: Literal["op", "quote"] = "op",
) -> list[ParsedMedia]:
    """The media a syndication body carries, as CDN URLs on trusted hosts.

    ``mediaDetails`` is primary (it carries videos); ``photos`` is the
    image-only fallback. Public for :mod:`acquire` and :mod:`chase.x`.
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
    """Every URL the post links (``entities.urls``) as ``(expanded_url, shortlink)``.

    Host-blind (the resolution decides what can be a source). Uses
    ``expanded_url``, never a bare ``t.co``, and de-dupes in order.
    ``shortlink`` is the ``t.co`` token in the raw text, ``None`` when absent.
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
