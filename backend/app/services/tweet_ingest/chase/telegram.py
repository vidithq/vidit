"""Chase a Telegram post: its public embed, for the date and any served media.

The auth-less embed (``https://t.me/<channel>/<id>?embed=1&mode=tme``) almost
always carries the post date and only sometimes the footage (a sensitive post
serves the date alone). The result is a link with a date, stored by the
resolution as off-platform footage.

Fail-soft: any error or unexpected HTML yields a footage-less
:class:`ChaseResult` naming the failure. A date without media is a valid result.

SSRF guard: :func:`urls.telegram_post_url` is the only gate to the fetch,
redirects are not followed, and every extracted media URL is re-checked with
:func:`is_trusted_media_url`.
"""

from __future__ import annotations

import html
import logging
import re

import httpx

from ..errors import TweetImportError, TweetUpstreamBusy, TweetUpstreamUnreachable
from ..records import ChasedPost, ChaseResult, ParsedMedia
from ..retry import is_transient, parse_retry_after, retrying
from ..urls import is_trusted_media_url, telegram_post_url

logger = logging.getLogger(__name__)

# ``mode=tme`` is the bare single-post view.
_EMBED_QUERY = "?embed=1&mode=tme"

_HTTP_TIMEOUT_S = 5.0
_USER_AGENT = "vidit-tweet-import/1.0"

# Root class of a rendered post; absent means the embed is unavailable.
_MESSAGE_RE = re.compile(r"tgme_widget_message\b")

# The post date: ISO 8601 ``datetime`` attribute on ``<time>``.
_TIME_RE = re.compile(r'<time[^>]+datetime="([^"]+)"')

# Footage: an inlined mp4 or a photo painted as the wrapper's ``background-image``.
_VIDEO_RE = re.compile(r'<video[^>]+src="([^"]+)"')
_PHOTO_RE = re.compile(
    r"tgme_widget_message_photo_wrap[^\"]*\"[^>]*background-image:url\('([^']+)'\)"
)

# A sensitive or oversized post ships a placeholder: its wrapper photo is a
# poster stand-in, not evidence (the date is still taken). The footer "VIEW IN
# TELEGRAM" link is on normal posts too, so it is not a withhold signal.
_MEDIA_WITHHELD_RE = re.compile(
    r"message_media_not_supported|Please open Telegram to view this post"
)


def _fetch_embed_html(post_url: str, *, client: httpx.Client | None) -> str | None:
    """The embed HTML for a canonical post URL, ``None`` when there is none.

    A throttled or unreachable Telegram is retried (:mod:`tweet_ingest.retry`)
    then raised, so the caller can tell "not readable now" from "no such post".
    """
    return retrying(lambda: _read_embed(post_url, client=client), what=post_url)


def _read_embed(post_url: str, *, client: httpx.Client | None) -> str | None:
    """One GET of the embed: the HTML, ``None``, or a transient raise.

    Redirects are not followed: :func:`urls.telegram_post_url` vets only the
    first hop, so a 3xx would slip the guard and reads as "unavailable".
    ``client`` is for tests (a ``MockTransport``).
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

    Order matters: an inlined video is real footage and wins; only without one
    does the withheld marker suppress the poster photo. Every URL is re-checked
    with :func:`is_trusted_media_url`, so a tampered embed cannot redirect the
    downstream fetch.
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

    ``chased`` with at least a date or media; ``no_target`` for a non-t.me
    target; ``transient_failure`` when throttled or unanswered after the retry
    schedule; ``not_accessible`` for a gone or unreadable embed. Never raises.
    ``client`` is for tests.
    """
    try:
        return _chase(target, client=client)
    except TweetImportError as exc:
        return ChaseResult(outcome="transient_failure" if is_transient(exc) else "not_accessible")
    except Exception:
        # Last-resort net: a chase must never fail the ingestion.
        logger.debug("Telegram embed chase failed for %s", target, exc_info=True)
        return ChaseResult(outcome="not_accessible")


def _chase(target: str, *, client: httpx.Client | None) -> ChaseResult:
    post_url = telegram_post_url(target)
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
    # ``url`` is the target as written: the resolution matches it back to the declared link.
    return ChaseResult(
        outcome="chased", post=ChasedPost(url=target, posted_at=posted_at, media=media)
    )
