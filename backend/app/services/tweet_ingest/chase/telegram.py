"""Chase a Telegram post: its public embed, for the date and any served media.

Off-platform OSINT sources are frequently Telegram posts
(``https://t.me/<channel>/<id>``). Telegram serves a public, auth-less embed for
a post at ``https://t.me/<channel>/<id>?embed=1&mode=tme``; the HTML carries the
post date almost always and the footage only sometimes (a sensitive post serves
neither the video nor the photo, only the date). This chaser reads that embed
for the date, taking the media as a bonus when the embed ships it. A t.me post
has no author or text this model holds, so what comes back is a link with a
date, which the resolution stores as off-platform footage.

Everything is fail-soft: an HTTP error, an unavailable embed, or unexpected HTML
yields a footage-less :class:`ChaseResult` naming the failure, never a raised
exception. A sensitive post (date, no media) is a valid result, not a failure.

SSRF guard: :func:`_telegram_post_url` is the only gate to the fetch, and it
admits nothing but a public ``t.me`` post URL (a known channel host plus a
numeric post id). Redirects are not followed, and every extracted media URL is
re-checked against :func:`is_trusted_media_url` before it is trusted.
"""

from __future__ import annotations

import html
import logging
import re
from urllib.parse import urlparse

import httpx

from ..errors import TweetImportError, TweetUpstreamBusy, TweetUpstreamUnreachable
from ..records import ChasedPost, ChaseResult, ParsedMedia
from ..retry import is_transient, parse_retry_after, retrying
from ..urls import TELEGRAM_HOST_RE, is_trusted_media_url

logger = logging.getLogger(__name__)

# A public t.me post path: ``/<channel>/<id>``, channel a bare username, id
# numeric. New shape (no existing regex covers the post path; the *host* match
# reuses ``TELEGRAM_HOST_RE``, the one home for "this link is a t.me post",
# shared with the source rule). Excludes the private ``/c/<n>/<m>`` and ``/joinchat/...`` forms
# (extra path segments / non-numeric id), which have no public embed anyway.
_TELEGRAM_POST_PATH_RE = re.compile(r"^/([A-Za-z0-9_]{1,64})/(\d{1,19})$")

# The embed variant the widget renders server-side; ``mode=tme`` is the bare
# single-post view.
_EMBED_QUERY = "?embed=1&mode=tme"

_HTTP_TIMEOUT_S = 5.0
_USER_AGENT = "vidit-tweet-import/1.0"

# The bare root class of a rendered post. Its absence means the embed is
# unavailable (deleted, non-existent, or a non-post URL that slipped the guard),
# so there is nothing to parse.
_MESSAGE_RE = re.compile(r"tgme_widget_message\b")

# The post date, an ISO 8601 ``datetime`` attribute on the ``<time>`` tag.
_TIME_RE = re.compile(r'<time[^>]+datetime="([^"]+)"')

# Footage: an inlined mp4 (``<video src=...>``) or a photo painted as the
# wrapper's ``background-image``. Both live on the Telegram CDN.
_VIDEO_RE = re.compile(r'<video[^>]+src="([^"]+)"')
_PHOTO_RE = re.compile(
    r"tgme_widget_message_photo_wrap[^\"]*\"[^>]*background-image:url\('([^']+)'\)"
)

# A sensitive / oversized post: the embed ships a placeholder, not the footage.
# When present, a wrapper photo tag is a poster stand-in, not evidence, so it is
# not taken (the date still is). Only the genuine withhold strings count; the
# footer "VIEW IN TELEGRAM" link is standard embed chrome present on normal posts
# too, so it is NOT a withhold signal (it would suppress real media).
_MEDIA_WITHHELD_RE = re.compile(
    r"message_media_not_supported|Please open Telegram to view this post"
)


def _telegram_post_url(url: str) -> str | None:
    """The canonical ``https://t.me/<channel>/<id>`` post URL, or ``None``.

    The SSRF gate: returns a URL only for a public Telegram post (a ``t.me``
    host per :data:`TELEGRAM_HOST_RE`, a bare channel, a numeric id). A private
    ``t.me/c/...`` link, a ``joinchat`` invite, a channel-only link, embedded
    credentials, a non-standard port, or any non-Telegram host all yield
    ``None`` and are never fetched.
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
    match = _TELEGRAM_POST_PATH_RE.match(parsed.path)
    if match is None:
        return None
    channel, post_id = match.group(1), match.group(2)
    return f"https://t.me/{channel}/{post_id}"


def _fetch_embed_html(post_url: str, *, client: httpx.Client | None) -> str | None:
    """The embed HTML for a canonical post URL, ``None`` when there is none to
    have.

    A throttled or unreachable Telegram is retried on the package's one schedule
    (:mod:`tweet_ingest.retry`) and, once that is spent, raised, so the caller
    can tell "not readable right now" from "no such post". Every other refusal
    is ``None`` on the first attempt.
    """
    return retrying(lambda: _read_embed(post_url, client=client), what=post_url)


def _read_embed(post_url: str, *, client: httpx.Client | None) -> str | None:
    """One GET of the embed: the HTML, ``None``, or a transient raise.

    Redirects are not followed: :func:`_telegram_post_url` vets only the first
    hop, so a 3xx to another host would slip the guard. A redirect therefore
    reads as "unavailable" and degrades to link + no date. ``client`` is for
    tests (a ``MockTransport``); production passes ``None``.
    """
    headers = {"User-Agent": _USER_AGENT, "Accept": "text/html"}
    target = post_url + _EMBED_QUERY
    try:
        if client is None:
            with httpx.Client(timeout=_HTTP_TIMEOUT_S, follow_redirects=False) as own_client:
                resp = own_client.get(target, headers=headers)
        else:
            resp = client.get(target, headers=headers)
    except httpx.HTTPError as exc:
        raise TweetUpstreamUnreachable(f"transport error: {exc}") from exc
    if resp.status_code == 429 or resp.status_code >= 500:
        raise TweetUpstreamBusy(
            f"upstream returned {resp.status_code}",
            retry_after=parse_retry_after(resp.headers.get("Retry-After")),
        )
    if resp.status_code != 200:
        return None
    return resp.text


def _extract_media(embed_html: str) -> list[ParsedMedia]:
    """The footage the embed serves: the inlined mp4, else the wrapper photo(s).

    Decision order matters: an inlined ``<video>`` on the Telegram CDN is real
    footage, so it is taken first regardless of any chrome text. Only when there
    is no such video does the withheld-media marker matter: a sensitive /
    oversized post ships a poster photo placeholder, so the photo path is
    suppressed there (the date still comes back). Every URL is re-checked against
    :func:`is_trusted_media_url` (only the Telegram CDN), so a tampered embed
    can't point the downstream fetch at an arbitrary host.
    """
    videos = [
        ParsedMedia(kind="video", remote_url=src, origin="quote")
        for src in (html.unescape(m.group(1)) for m in _VIDEO_RE.finditer(embed_html))
        if is_trusted_media_url(src)
    ]
    if videos:
        return videos
    if _MEDIA_WITHHELD_RE.search(embed_html) is not None:
        return []
    return [
        ParsedMedia(kind="image", remote_url=src, origin="quote")
        for src in (html.unescape(m.group(1)) for m in _PHOTO_RE.finditer(embed_html))
        if is_trusted_media_url(src)
    ]


def chase(target: str, *, client: httpx.Client | None = None) -> ChaseResult:
    """The Telegram post ``target`` names, read through its public embed.

    ``chased`` when the embed yields at least a date or a media, ``no_target``
    when ``target`` is not a public t.me post at all, ``transient_failure`` when
    Telegram throttled us or never answered with the retry schedule already
    spent, and ``not_accessible`` for an embed that is gone or serves nothing
    this parser can read. Never raises: unexpected HTML and anything else
    unforeseen degrade to ``not_accessible``. ``client`` is for tests.
    """
    try:
        return _chase(target, client=client)
    except TweetImportError as exc:
        return ChaseResult(outcome="transient_failure" if is_transient(exc) else "not_accessible")
    except Exception:
        # Last-resort net over an external-network + untrusted-HTML boundary:
        # this brick's contract is that a chase can never fail the ingestion, so
        # anything unforeseen degrades to "no date, no media", logged for
        # visibility.
        logger.debug("Telegram embed chase failed for %s", target, exc_info=True)
        return ChaseResult(outcome="not_accessible")


def _chase(target: str, *, client: httpx.Client | None) -> ChaseResult:
    post_url = _telegram_post_url(target)
    if post_url is None:
        return ChaseResult(outcome="no_target")
    embed_html = _fetch_embed_html(post_url, client=client)
    if embed_html is None or _MESSAGE_RE.search(embed_html) is None:
        return ChaseResult(outcome="not_accessible")
    time_match = _TIME_RE.search(embed_html)
    posted_at = html.unescape(time_match.group(1)) if time_match is not None else None
    media = _extract_media(embed_html)
    if posted_at is None and not media:
        return ChaseResult(outcome="not_accessible")
    # ``url`` is the target as the post wrote it, not the canonical form: the
    # resolution matches this footage back onto the link the analyst declared.
    return ChaseResult(
        outcome="chased", post=ChasedPost(url=target, posted_at=posted_at, media=media)
    )
