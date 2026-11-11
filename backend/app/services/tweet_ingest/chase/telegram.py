"""Chase a Telegram post: its public embed, for the date and any served media.

The auth-less embed (``https://t.me/<channel>/<id>?embed=1&mode=tme``) almost
always carries the post date and only sometimes the footage (a sensitive post
serves the date alone). The result is a link with a date, stored by the
resolution as off-platform footage.

Unexpected HTML yields a footage-less :class:`ChaseResult` naming the failure.
A date without media is a valid result.

SSRF guard: :func:`urls.telegram_post_url` is the only gate to the fetch,
redirects are not followed, and every extracted media URL is re-checked with
:func:`is_trusted_media_url`.
"""

from __future__ import annotations

import html
import re

import httpx

from ..records import ChaseResult, ParsedMedia
from ..urls import is_trusted_media_url, telegram_post_url
from ._http import embed_result, read_page

# ``mode=tme`` is the bare single-post view.
_EMBED_QUERY = "?embed=1&mode=tme"

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

# The same notice inside ``media_not_supported_cont`` is hidden by the embed's
# CSS and shown by its script only when the browser cannot draw a custom emoji
# or a sticker; the post's media is served beside it, so it withholds nothing.
_CLIENT_FALLBACK_RE = re.compile(
    r'<div class="media_not_supported_cont"[^>]*>.*?</div>\s*</div>\s*</div>', re.DOTALL
)


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
    if _MEDIA_WITHHELD_RE.search(_CLIENT_FALLBACK_RE.sub("", embed_html)) is not None:
        return []
    return [
        ParsedMedia(kind="image", remote_url=src, origin="quote")
        for src in (html.unescape(m.group(1)) for m in _PHOTO_RE.finditer(embed_html))
        if is_trusted_media_url(src)
    ]


def chase(target: str, *, client: httpx.Client | None = None) -> ChaseResult:
    """The Telegram post ``target`` names, read through its public embed.

    ``no_target`` for a non-t.me target; ``not_accessible`` for a gone or
    unreadable embed. A throttled or unreachable Telegram raises once the
    retries are spent (``chase.chase_post`` names it ``transient_failure``).
    """
    post_url = telegram_post_url(target)
    if post_url is None:
        return ChaseResult(outcome="no_target")
    embed_html = read_page(post_url + _EMBED_QUERY, client=client)
    if embed_html is None or _MESSAGE_RE.search(embed_html) is None:
        return ChaseResult(outcome="not_accessible")
    time_match = _TIME_RE.search(embed_html)
    posted_at = html.unescape(time_match.group(1)) if time_match is not None else None
    return embed_result(target, posted_at, _extract_media(embed_html))
