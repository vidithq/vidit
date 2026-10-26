"""The URL vocabulary of ingestion: what a link names, which hosts are trusted.

Pure string work, no I/O:

* :func:`normalise_tweet_url` (the one parse, at the router) and
  :func:`canonical_tweet_url` (the one build, at the engine's exit);
* the host predicates the source rule and the chase ask;
* :func:`x_status_posted_at`, an X post's time read off its status id;
* :data:`CONTEXT_HOSTS`, the closed list of hosts that never carry the filmed act;
* the media-host allowlist every remote fetch checks (:func:`is_trusted_media_url`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlparse

from app.services.imagery import PROVIDERS

from .errors import InvalidTweetUrl

# ── Hosts ─────────────────────────────────────────────────────────────────

_TWITTER_HOSTS = frozenset({"x.com", "www.x.com", "twitter.com", "www.twitter.com"})

TWITTER_URL_HOST_RE = re.compile(r"^(?:www\.)?(?:x|twitter)\.com$", re.IGNORECASE)
T_CO_HOST_RE = re.compile(r"^t\.co$", re.IGNORECASE)
TELEGRAM_HOST_RE = re.compile(r"^(?:www\.)?t\.me$", re.IGNORECASE)
TIKTOK_HOST_RE = re.compile(r"^(?:www\.|m\.)?tiktok\.com$", re.IGNORECASE)
TIKTOK_SHORT_HOST_RE = re.compile(r"^v[mt]\.tiktok\.com$", re.IGNORECASE)

# A tweet status path: ``/<handle>/status/<id>`` or the handle-less
# ``/i/web/status/<id>``. Separates a status from a profile or search page.
X_STATUS_URL_RE = re.compile(r"(?:x|twitter)\.com/(?:\w+/status|i/web/status)/(\d+)", re.IGNORECASE)

# A public t.me post path: ``/<channel>/<id>``. Excludes the private
# ``/c/<n>/<m>`` and ``/joinchat/...`` forms, which have no public embed.
TELEGRAM_POST_PATH_RE = re.compile(r"^/([A-Za-z0-9_]{1,64})/(\d{1,19})$")

# A TikTok post path: ``/@<user>/video/<id>`` or ``/@<user>/photo/<id>``.
TIKTOK_POST_PATH_RE = re.compile(r"^/@[A-Za-z0-9_.]{1,64}/(?:video|photo)/(\d{1,25})/?$")
# A TikTok short link: ``vm.tiktok.com/<code>``, ``vt.tiktok.com/<code>`` or
# ``www.tiktok.com/t/<code>``. It names no post until its redirect is read.
TIKTOK_SHORT_PATH_RE = re.compile(r"^/([A-Za-z0-9]{1,32})/?$")
TIKTOK_T_PATH_RE = re.compile(r"^/t/([A-Za-z0-9]{1,32})/?$")


def hostname(url: str) -> str:
    """``url``'s lowercased host, ``""`` when it has none or does not parse."""
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def x_status_id(url: str) -> str | None:
    """The X status id ``url`` names, or ``None``.

    Host-gated: a non-X URL carrying ``x.com/<handle>/status/<id>`` in its path
    (an archive.org capture) must never be chased as a status.
    """
    if TWITTER_URL_HOST_RE.match(hostname(url)) is None:
        return None
    match = X_STATUS_URL_RE.search(url)
    return match.group(1) if match is not None else None


# X's snowflake epoch, 2010-11-04T01:42:54.657Z: an id holds its post's millisecond above bit 22.
X_SNOWFLAKE_EPOCH_MS = 1288834974657
# Ids from before snowflakes are sequential, all below 3e10, and decode into the epoch's first
# seconds. An instant inside the epoch's first day is therefore not a post time.
_MIN_SNOWFLAKE_OFFSET_MS = 86_400_000


def x_status_posted_at(url: str, *, now: datetime | None = None) -> datetime | None:
    """When the X status ``url`` names was posted, read off its id, or ``None``.

    Exact and fetch-free, cut to the second (the precision X serves a post's date at). ``None``
    for a non-status URL, a pre-snowflake id, and an instant after ``now``, which no real post
    carries.
    """
    status_id = x_status_id(url)
    if status_id is None:
        return None
    offset_ms = int(status_id) >> 22
    if offset_ms < _MIN_SNOWFLAKE_OFFSET_MS:
        return None
    posted_at = datetime.fromtimestamp((X_SNOWFLAKE_EPOCH_MS + offset_ms) // 1000, UTC)
    if posted_at > (now or datetime.now(UTC)):
        return None
    return posted_at


ContextKind = Literal["satellite", "aircraft", "article", "other"]


@dataclass(frozen=True)
class ContextHost:
    """What a link on a context host becomes: a ``context`` source of this kind and title."""

    kind: ContextKind
    # The provider's name for an imagery tool, ``""`` otherwise.
    title: str = ""


# Hosts that never carry the filmed act, each with the path prefix it covers (``""`` for the
# whole host). A host matches itself and its subdomains (:func:`_host_matches_base`). Closed on
# purpose: a news site can host the only copy of the footage, so no open-ended rule demotes a
# link to context. Every imagery provider (``services/imagery.PROVIDERS``) comes first, of its
# first kind and titled with its name; ``docs/ingestion.md`` lists the rest.
CONTEXT_HOSTS: tuple[tuple[str, str, ContextHost], ...] = (
    *(
        (base, prefix, ContextHost(provider.kinds[0], provider.name))
        for provider in PROVIDERS
        for base, prefix in provider.hosts
    ),
    ("mapcarta.com", "", ContextHost("other")),
    ("geoview.info", "", ContextHost("other")),
    ("oct7map.com", "", ContextHost("other")),
    ("3rbmap.com", "", ContextHost("other")),
    ("wikipedia.org", "", ContextHost("article")),
    ("gofundme.com", "", ContextHost("other")),
)


def context_host(url: str) -> ContextHost | None:
    """The :data:`CONTEXT_HOSTS` entry ``url`` falls under, or ``None``."""
    host = hostname(url)
    if not host:
        return None
    try:
        path = urlparse(url).path.lower()
    except ValueError:
        return None
    for base, prefix, entry in CONTEXT_HOSTS:
        if _host_matches_base(host, base) and path.startswith(prefix):
            return entry
    return None


def _plain_web_url(url: str) -> tuple[str, str] | None:
    """``url``'s lowercased host and its path, or ``None`` unless it is a plain
    ``http(s)`` URL: no credentials, no port. The first check of every chase gate."""
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or port:
        return None
    return (parsed.hostname or "").lower(), parsed.path


def telegram_post_url(url: str) -> str | None:
    """The canonical ``https://t.me/<channel>/<id>`` post URL, or ``None``.

    The SSRF gate of the Telegram chase: only a public post passes. Private
    ``t.me/c/...`` links, invites, channel-only links, credentials, ports and
    non-Telegram hosts yield ``None`` and are never fetched.
    """
    parts = _plain_web_url(url)
    if parts is None or TELEGRAM_HOST_RE.match(parts[0]) is None:
        return None
    match = TELEGRAM_POST_PATH_RE.match(parts[1])
    if match is None:
        return None
    channel, post_id = match.group(1), match.group(2)
    return f"https://t.me/{channel}/{post_id}"


def tiktok_post_id(url: str) -> str | None:
    """The id of the TikTok video or photo post ``url`` names, or ``None``.

    The SSRF gate of the TikTok chase, with :func:`tiktok_short_url`: the chase
    fetches only ``www.tiktok.com/embed/v2/<id>`` for the id this returns.
    """
    parts = _plain_web_url(url)
    if parts is None or TIKTOK_HOST_RE.match(parts[0]) is None:
        return None
    match = TIKTOK_POST_PATH_RE.match(parts[1])
    return match.group(1) if match is not None else None


def tiktok_short_url(url: str) -> str | None:
    """The canonical ``https`` form of a TikTok short link, or ``None``.

    A short link names no post: the chase reads its one redirect, which must
    itself pass :func:`tiktok_post_id`.
    """
    parts = _plain_web_url(url)
    if parts is None:
        return None
    host, path = parts
    if TIKTOK_SHORT_HOST_RE.match(host) is not None:
        match = TIKTOK_SHORT_PATH_RE.match(path)
        return f"https://{host}/{match.group(1)}/" if match is not None else None
    if TIKTOK_HOST_RE.match(host) is not None:
        match = TIKTOK_T_PATH_RE.match(path)
        return f"https://www.tiktok.com/t/{match.group(1)}/" if match is not None else None
    return None


def is_importable_link(url: str) -> bool:
    """Whether a chaser reads ``url``: an X status, a public Telegram post or a TikTok post.

    The chasers' own gates (:func:`x_status_id`, :func:`telegram_post_url`,
    :func:`tiktok_post_id`, :func:`tiktok_short_url`), so the answer
    matches what ``chase.chase_post`` fetches. Mirrored by frontend
    ``lib/sources.ts::isImportableLink``; change both.
    """
    return (
        x_status_id(url) is not None
        or telegram_post_url(url) is not None
        or tiktok_post_id(url) is not None
        or tiktok_short_url(url) is not None
    )


# ── Reading a post URL ────────────────────────────────────────────────────


_TWEET_ID_PATTERN = re.compile(r"^\d{5,25}$")

# The handle of a URL that names none (``/i/web/status/<id>``).
NO_HANDLE = "i"


@dataclass(frozen=True)
class NormalisedTweetUrl:
    tweet_id: str
    handle: str


def normalise_tweet_url(raw: str) -> NormalisedTweetUrl:
    """Validate a tweet URL and return the post it names.

    Accepts ``x.com`` / ``twitter.com`` (with or without ``www.``), drops query
    and fragment. Anything else raises ``InvalidTweetUrl``. The handle's
    existence is not checked (the syndication 404 becomes ``TweetNotAccessible``).
    """
    parsed = urlparse(raw.strip())
    if parsed.scheme not in ("http", "https"):
        raise InvalidTweetUrl("Not a tweet URL")
    if (parsed.hostname or "").lower() not in _TWITTER_HOSTS:
        raise InvalidTweetUrl("Not a tweet URL")

    # ``/<handle>/status/<id>``, or ``/i/web/status/<id>`` from some clients.
    parts = [p for p in parsed.path.split("/") if p]
    tweet_id: str | None = None
    handle: str | None = None
    if len(parts) >= 3 and parts[1] == "status":
        handle = parts[0]
        tweet_id = parts[2]
    elif len(parts) >= 4 and parts[0] == "i" and parts[1] == "web" and parts[2] == "status":
        handle = NO_HANDLE
        tweet_id = parts[3]
    if tweet_id is None or handle is None:
        raise InvalidTweetUrl("Not a tweet URL")
    if not _TWEET_ID_PATTERN.match(tweet_id):
        raise InvalidTweetUrl("Not a tweet URL")

    return NormalisedTweetUrl(tweet_id=tweet_id, handle=handle)


# ── Writing a post URL ────────────────────────────────────────────────────


def canonical_tweet_url(tweet_id: str, handle: str) -> str:
    """The canonical permalink, the one build of a post URL.

    :data:`NO_HANDLE` keeps the ``/i/web/status/`` form, since
    ``x.com/i/status/<id>`` 404s.
    """
    if handle == NO_HANDLE:
        return f"https://x.com/i/web/status/{tweet_id}"
    return f"https://x.com/{handle}/status/{tweet_id}"


# ── Media hosts ───────────────────────────────────────────────────────────


# Allowlist of hosts the backend will fetch media from.
TWITTER_MEDIA_HOSTS = frozenset({"pbs.twimg.com", "video.twimg.com"})

# Telegram's CDN (apex plus ``cdnN`` shards) and ``telesco.pe``, matched by
# dot-boundary suffix (:func:`_host_matches_base`) so ``evil-cdn-telegram.org`` fails.
TELEGRAM_MEDIA_BASE_HOSTS = frozenset({"cdn-telegram.org", "telesco.pe"})

# TikTok's CDN: the global, EU and US domains its embed serves files from, matched
# by dot-boundary suffix like Telegram's.
TIKTOK_MEDIA_BASE_HOSTS = frozenset({"tiktokcdn.com", "tiktokcdn-eu.com", "tiktokcdn-us.com"})


def _host_matches_base(host: str, base: str) -> bool:
    """Whether ``host`` is ``base`` or a subdomain of it (dot-boundary, not substring)."""
    return host == base or host.endswith("." + base)


def is_trusted_media_url(url: str) -> bool:
    """The allowlist gate every remote media fetch passes first (SSRF guard).

    Admits the X CDN (exact hosts) and the Telegram and TikTok CDNs
    (dot-boundary suffix), ``https`` only. The syndication mapper, the Telegram
    and TikTok embed readers and the archive chase all call this.
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
    return any(
        _host_matches_base(host, base)
        for base in TELEGRAM_MEDIA_BASE_HOSTS | TIKTOK_MEDIA_BASE_HOSTS
    )
