"""Chase a TikTok post through its public embed (``www.tiktok.com/embed/v2/<id>``).

The embed renders its state as JSON in the ``__FRONTITY_CONNECT_STATE__`` script: the
post's date, and one video file or one image per photo. A short link costs one more GET:
its redirect is read, never followed, and must name a post itself.

SSRF guard: :func:`urls.tiktok_post_id` and :func:`urls.tiktok_short_url` are the only
gates to a fetch, and every extracted media URL passes :func:`is_trusted_media_url`.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

import httpx

from ..records import ChaseResult, ParsedMedia
from ..urls import is_trusted_media_url, tiktok_post_id, tiktok_short_url
from ._http import embed_result, get_page, read_page

_EMBED_URL = "https://www.tiktok.com/embed/v2/{post_id}"

_STATE_RE = re.compile(
    r'<script[^>]*\bid="__FRONTITY_CONNECT_STATE__"[^>]*>(.*?)</script>', re.DOTALL
)


def _dig(value: Any, *keys: str) -> Any:
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _first_str(values: Any) -> str | None:
    if isinstance(values, list) and values and isinstance(values[0], str):
        return values[0]
    return None


def _resolve_short(short_url: str, *, client: httpx.Client | None) -> str | None:
    resp = get_page(short_url, client=client)
    return tiktok_post_id(resp.headers["Location"]) if resp.is_redirect else None


def _video_data(embed_html: str, post_id: str) -> dict[str, Any] | None:
    """``None`` when absent, empty or flagged by a non-zero ``statusCode`` (a private or
    removed post)."""
    match = _STATE_RE.search(embed_html)
    if match is None:
        return None
    try:
        state = json.loads(match.group(1))
    except ValueError:
        return None
    entry = _dig(state, "source", "data", f"/embed/v2/{post_id}")
    data = _dig(entry, "videoData")
    if not isinstance(data, dict) or not data:
        return None
    if _dig(entry, "statusCode") not in (None, 0) or data.get("statusCode") not in (None, 0):
        return None
    return data


def _extract_media(data: dict[str, Any]) -> list[ParsedMedia]:
    video = _first_str(_dig(data, "itemInfos", "video", "urls"))
    if video is not None and is_trusted_media_url(video):
        return [ParsedMedia(kind="video", remote_url=video, origin="quote")]
    images = _dig(data, "imagePostInfo", "displayImages")
    return [
        ParsedMedia(kind="image", remote_url=url, origin="quote")
        for image in (images if isinstance(images, list) else [])
        if (url := _first_str(_dig(image, "urlList"))) is not None and is_trusted_media_url(url)
    ]


def _posted_at(data: dict[str, Any]) -> str | None:
    created = _dig(data, "itemInfos", "createTime")
    try:
        return datetime.fromtimestamp(int(created), UTC).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def chase(target: str, *, client: httpx.Client | None = None) -> ChaseResult:
    """``no_target`` for a link that is no TikTok post or short link; ``not_accessible`` for
    an unreadable one. A throttled or unreachable TikTok raises once the retries are spent.
    """
    post_id = tiktok_post_id(target)
    if post_id is None:
        short_url = tiktok_short_url(target)
        if short_url is None:
            return ChaseResult(outcome="no_target")
        post_id = _resolve_short(short_url, client=client)
        if post_id is None:
            return ChaseResult(outcome="not_accessible")
    embed_html = read_page(_EMBED_URL.format(post_id=post_id), client=client)
    data = _video_data(embed_html, post_id) if embed_html is not None else None
    if data is None:
        return ChaseResult(outcome="not_accessible")
    return embed_result(target, _posted_at(data), _extract_media(data))
