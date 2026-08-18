"""The URL vocabulary of ingestion: what a link names, which hosts are trusted.

Pure string work, no I/O, so every brick can read it without pulling a fetch
module in. Three jobs live here because all three answer "what is this URL":

* reading an X post URL down to its id (:func:`normalise_tweet_url`, the one
  parse, run at the router) and writing one back from an id plus a handle
  (:func:`canonical_tweet_url`, the one build, run at the engine's exit);
* the host predicates the source rule and the chase ask (is this an X status,
  an X link naming none, a ``t.me`` post);
* the media-host allowlist every remote fetch checks first
  (:func:`is_trusted_media_url`).
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
# ``/i/web/status/<id>``. Single source of truth for "this X link names a
# status", which is what the chase needs and what separates a status from a
# profile or a search page.
X_STATUS_URL_RE = re.compile(r"(?:x|twitter)\.com/(?:\w+/status|i/web/status)/(\d+)", re.IGNORECASE)


def hostname(url: str) -> str:
    """``url``'s lowercased host, ``""`` when it has none or does not parse."""
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def x_status_id(url: str) -> str | None:
    """The X status id ``url`` names, or ``None`` when it names none.

    Host-gated on purpose: a non-X URL that merely carries
    ``x.com/<handle>/status/<id>`` inside its path, an archive.org capture being
    the common OSINT case, names no status of its own and must never be chased
    as one.
    """
    if TWITTER_URL_HOST_RE.match(hostname(url)) is None:
        return None
    match = X_STATUS_URL_RE.search(url)
    return match.group(1) if match is not None else None


# ── Reading a post URL ────────────────────────────────────────────────────


_TWEET_ID_PATTERN = re.compile(r"^\d{5,25}$")

# The handle a URL carries when it names none (the ``/i/web/status/<id>``
# form). The caller sources the real handle from the response.
NO_HANDLE = "i"


@dataclass(frozen=True)
class NormalisedTweetUrl:
    tweet_id: str
    handle: str


def normalise_tweet_url(raw: str) -> NormalisedTweetUrl:
    """Validate a tweet URL and return the post it names.

    The one parse. The URL a caller typed is read down to an id plus a handle
    here and never carried further: what a surface displays is built back from
    the pair by :func:`canonical_tweet_url`.

    Accepts ``x.com`` / ``twitter.com`` (with or without ``www.``), strips query
    and fragment, reduces the path to ``/<handle>/status/<id>``. Anything else
    (profiles, lists, search, home feed, unrelated host) raises
    ``InvalidTweetUrl``. The handle is not validated for existence: that is the
    syndication endpoint's 404 turning into ``TweetNotAccessible``.
    """
    parsed = urlparse(raw.strip())
    if parsed.scheme not in ("http", "https"):
        raise InvalidTweetUrl("Not a tweet URL")
    if (parsed.hostname or "").lower() not in _TWITTER_HOSTS:
        raise InvalidTweetUrl("Not a tweet URL")

    # Path shape: /<handle>/status/<id>, and also the older /i/web/status/<id>
    # form some clients emit with no handle context.
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
    """The canonical permalink for ``tweet_id`` posted by ``handle``.

    The one build: `tweet_id` is the identity every surface carries, and a URL
    is written from it here and nowhere else. ``handle`` is :data:`NO_HANDLE`
    when the caller has none, and that form is kept as X serves it, since
    ``x.com/i/status/<id>`` 404s.
    """
    if handle == NO_HANDLE:
        return f"https://x.com/i/web/status/{tweet_id}"
    return f"https://x.com/{handle}/status/{tweet_id}"


# ── Media hosts ───────────────────────────────────────────────────────────


# Allowlist of hosts the backend will fetch media from.
TWITTER_MEDIA_HOSTS = frozenset({"pbs.twimg.com", "video.twimg.com"})

# Registrable bases Telegram serves footage from: its own CDN (the apex
# ``cdn-telegram.org`` plus its ``cdnN.cdn-telegram.org`` shards) and
# ``telesco.pe``. Matched by strict dot-boundary suffix (see
# :func:`_host_matches_base`), never a substring, so a look-alike like
# ``evil-cdn-telegram.org`` is rejected.
TELEGRAM_MEDIA_BASE_HOSTS = frozenset({"cdn-telegram.org", "telesco.pe"})


def _host_matches_base(host: str, base: str) -> bool:
    """Whether ``host`` is ``base`` itself or a subdomain of it.

    A dot-boundary suffix test, not a substring: ``cdn4.cdn-telegram.org``
    matches ``cdn-telegram.org`` while ``evil-cdn-telegram.org`` (shares the
    trailing string but not the ``.`` boundary) does not.
    """
    return host == base or host.endswith("." + base)


def is_trusted_media_url(url: str) -> bool:
    """The allowlist gate every remote media fetch passes first.

    Single source of truth: the syndication mapper (filtering what a payload
    advertises), the Telegram embed reader and the archive chase (before
    fetching a CDN media) all call this. Drift would silently drop legitimate
    media or open an outbound fetch to an arbitrary host (SSRF). Admits the X
    CDN (``TWITTER_MEDIA_HOSTS``, exact) and the Telegram CDN
    (``TELEGRAM_MEDIA_BASE_HOSTS``, strict dot-boundary suffix so a look-alike
    host cannot slip through), ``https`` only.
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
