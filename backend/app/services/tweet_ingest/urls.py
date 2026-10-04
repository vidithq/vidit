"""The URL vocabulary of ingestion: what a link names, which hosts are trusted.

Pure string work, no I/O:

* :func:`normalise_tweet_url` (the one parse, at the router) and
  :func:`canonical_tweet_url` (the one build, at the engine's exit);
* the host predicates the source rule and the chase ask;
* the media-host allowlist every remote fetch checks (:func:`is_trusted_media_url`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

from .errors import InvalidTweetUrl

# ── Hosts ─────────────────────────────────────────────────────────────────

_TWITTER_HOSTS = frozenset({"x.com", "www.x.com", "twitter.com", "www.twitter.com"})

TWITTER_URL_HOST_RE = re.compile(r"^(?:www\.)?(?:x|twitter)\.com$", re.IGNORECASE)
T_CO_HOST_RE = re.compile(r"^t\.co$", re.IGNORECASE)
TELEGRAM_HOST_RE = re.compile(r"^(?:www\.)?t\.me$", re.IGNORECASE)

# A tweet status path: ``/<handle>/status/<id>`` or the handle-less
# ``/i/web/status/<id>``. Separates a status from a profile or search page.
X_STATUS_URL_RE = re.compile(r"(?:x|twitter)\.com/(?:\w+/status|i/web/status)/(\d+)", re.IGNORECASE)

# A public t.me post path: ``/<channel>/<id>``. Excludes the private
# ``/c/<n>/<m>`` and ``/joinchat/...`` forms, which have no public embed.
TELEGRAM_POST_PATH_RE = re.compile(r"^/([A-Za-z0-9_]{1,64})/(\d{1,19})$")


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


def telegram_post_url(url: str) -> str | None:
    """The canonical ``https://t.me/<channel>/<id>`` post URL, or ``None``.

    The SSRF gate of the Telegram chase: only a public post passes. Private
    ``t.me/c/...`` links, invites, channel-only links, credentials, ports and
    non-Telegram hosts yield ``None`` and are never fetched.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.username or parsed.password or parsed.port:
        return None
    if TELEGRAM_HOST_RE.match((parsed.hostname or "").lower()) is None:
        return None
    match = TELEGRAM_POST_PATH_RE.match(parsed.path)
    if match is None:
        return None
    channel, post_id = match.group(1), match.group(2)
    return f"https://t.me/{channel}/{post_id}"


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


def _host_matches_base(host: str, base: str) -> bool:
    """Whether ``host`` is ``base`` or a subdomain of it (dot-boundary, not substring)."""
    return host == base or host.endswith("." + base)


def is_trusted_media_url(url: str) -> bool:
    """The allowlist gate every remote media fetch passes first (SSRF guard).

    Admits the X CDN (exact hosts) and the Telegram CDN (dot-boundary suffix),
    ``https`` only. The syndication mapper, the Telegram embed reader and the
    archive chase all call this.
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
