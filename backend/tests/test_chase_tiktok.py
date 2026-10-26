"""Unit tests for the TikTok chaser (offline).

Covers the SSRF URL gates (``urls.tiktok_post_id``, ``urls.tiktok_short_url``),
the short link redirect read, and the embed parser over a small synthetic page
with the embed's ``__FRONTITY_CONNECT_STATE__`` structure. Fetches use an
``httpx.MockTransport`` client.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.services.tweet_ingest import retry
from app.services.tweet_ingest.chase import chase_post
from app.services.tweet_ingest.chase.tiktok import chase
from app.services.tweet_ingest.records import ChaseResult, ParsedMedia
from app.services.tweet_ingest.urls import (
    is_trusted_media_url,
    tiktok_post_id,
    tiktok_short_url,
)

_ID = "7400000000000000001"
_POST = f"https://www.tiktok.com/@someone/video/{_ID}"
_VIDEO = f"https://v16m.tiktokcdn-eu.com/abc/{_ID}.mp4?x-expires=1"
_IMAGES = [f"https://p16-common-sign.tiktokcdn-eu.com/obj/photo{n}.jpeg" for n in (1, 2, 3)]
_CREATED = 1772630400  # 2026-03-04T13:20:00Z

# ── URL gates ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        _POST,
        f"https://tiktok.com/@someone/video/{_ID}",
        f"https://m.tiktok.com/@some.one_2/video/{_ID}/",
        f"https://www.tiktok.com/@someone/photo/{_ID}?is_from_webapp=1",
        f"http://WWW.TIKTOK.COM/@someone/video/{_ID}",
    ],
)
def test_post_id_accepts_post_links(url: str) -> None:
    assert tiktok_post_id(url) == _ID


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://vm.tiktok.com/ZMabc123/", "https://vm.tiktok.com/ZMabc123/"),
        ("http://vt.tiktok.com/ZSxyz", "https://vt.tiktok.com/ZSxyz/"),
        ("https://www.tiktok.com/t/ZTcode9/", "https://www.tiktok.com/t/ZTcode9/"),
        ("https://tiktok.com/t/ZTcode9", "https://www.tiktok.com/t/ZTcode9/"),
    ],
)
def test_short_url_accepts_short_links(url: str, expected: str) -> None:
    assert tiktok_short_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://www.tiktok.com/@someone",  # profile
        f"https://www.tiktok.com/embed/v2/{_ID}",  # the embed is fetched, never pasted
        "https://www.tiktok.com/@someone/video/notanumber",
        f"https://tiktok.com.evil.example/@someone/video/{_ID}",  # look-alike host
        f"https://eviltiktok.com/@someone/video/{_ID}",
        f"https://user:pass@www.tiktok.com/@someone/video/{_ID}",  # credentials
        f"https://www.tiktok.com:8443/@someone/video/{_ID}",  # port
        f"ftp://www.tiktok.com/@someone/video/{_ID}",
        "https://vm.tiktok.com/",  # short host, no code
        "https://vm.tiktok.com/a/b",  # short host, extra segment
        "https://evil.tiktok.com/ZMabc123/",  # an unknown subdomain
        "not a url",
    ],
)
def test_gates_refuse_everything_else(url: str) -> None:
    assert tiktok_post_id(url) is None
    assert tiktok_short_url(url) is None


@pytest.mark.parametrize(
    "url,trusted",
    [
        (_VIDEO, True),
        ("https://v16-webapp.tiktokcdn.com/a.mp4", True),
        ("https://v19.tiktokcdn-us.com/a.mp4", True),
        ("https://tiktokcdn-eu.com.evil.example/a.mp4", False),
        ("https://eviltiktokcdn.com/a.mp4", False),
        ("http://v16m.tiktokcdn-eu.com/a.mp4", False),
    ],
)
def test_media_allowlist_admits_the_tiktok_cdn_only(url: str, trusted: bool) -> None:
    assert is_trusted_media_url(url) is trusted


# ── Embed parser ──────────────────────────────────────────────────────────


def _page(video_data: dict[str, Any] | None, *, post_id: str = _ID, **entry: Any) -> str:
    """A minimal embed page: the state script holding ``videoData`` for ``post_id``."""
    state = {"source": {"data": {f"/embed/v2/{post_id}": {"videoData": video_data, **entry}}}}
    return (
        "<html><body><div id=main></div>"
        f'<script id="__FRONTITY_CONNECT_STATE__" type="application/json">{json.dumps(state)}'
        "</script></body></html>"
    )


def _video_post() -> dict[str, Any]:
    return {
        "itemInfos": {"createTime": str(_CREATED), "video": {"urls": [_VIDEO]}},
        "musicInfos": {"playUrl": ["https://sf16.tiktokcdn-eu.com/music.mp3"]},
    }


def _photo_post() -> dict[str, Any]:
    return {
        "itemInfos": {"createTime": _CREATED, "video": {"urls": []}},
        "imagePostInfo": {"displayImages": [{"urlList": [url, url + "?alt"]} for url in _IMAGES]},
    }


def _client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _embed_handler(page: str, *, status: int = 200) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == f"https://www.tiktok.com/embed/v2/{_ID}"
        return httpx.Response(status, text=page)

    return handler


def _chase(handler: Callable[[httpx.Request], httpx.Response], target: str = _POST) -> ChaseResult:
    client = _client(handler)
    try:
        return chase(target, client=client)
    finally:
        client.close()


def test_a_video_post_yields_its_file_and_date() -> None:
    result = _chase(_embed_handler(_page(_video_post())))
    assert result.outcome == "chased" and result.post is not None
    assert result.post.url == _POST
    assert result.post.posted_at == "2026-03-04T13:20:00+00:00"
    assert result.post.media == [ParsedMedia(kind="video", remote_url=_VIDEO, origin="quote")]


def test_a_photo_post_yields_one_image_per_photo() -> None:
    result = _chase(_embed_handler(_page(_photo_post())))
    assert result.post is not None
    assert [(m.kind, m.remote_url) for m in result.post.media] == [
        ("image", url) for url in _IMAGES
    ]


def test_an_untrusted_media_url_is_dropped() -> None:
    data = _video_post()
    data["itemInfos"]["video"]["urls"] = ["https://evil.example/a.mp4"]
    result = _chase(_embed_handler(_page(data)))
    assert result.post is not None and result.post.media == []


def test_a_short_link_reads_its_redirect_once() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.host == "vm.tiktok.com":
            return httpx.Response(302, headers={"Location": f"{_POST}?_t=abc&_r=1"})
        return _embed_handler(_page(_video_post()))(request)

    result = _chase(handler, "https://vm.tiktok.com/ZMabc123/")
    assert result.outcome == "chased" and result.post is not None
    # The target as written, so the resolution matches it back to the declared link.
    assert result.post.url == "https://vm.tiktok.com/ZMabc123/"
    assert seen == ["https://vm.tiktok.com/ZMabc123/", f"https://www.tiktok.com/embed/v2/{_ID}"]


@pytest.mark.parametrize(
    "location",
    [
        "https://evil.example/@someone/video/1",  # off-site
        f"https://tiktok.com.evil.example/@someone/video/{_ID}",  # look-alike
        "https://www.tiktok.com/login?redirect_url=x",  # no post
        f"/@someone/video/{_ID}",  # relative
        "",
    ],
)
def test_a_short_link_redirecting_off_a_post_is_refused(location: str) -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(302, headers={"Location": location})

    assert _chase(handler, "https://vt.tiktok.com/ZSxyz/").outcome == "not_accessible"
    assert seen == ["https://vt.tiktok.com/ZSxyz/"]


def test_a_short_link_without_a_redirect_is_not_accessible() -> None:
    result = _chase(
        lambda _r: httpx.Response(200, text="<html></html>"), "https://vm.tiktok.com/ZM1/"
    )
    assert result.outcome == "not_accessible"


def test_a_throttled_embed_is_retried_then_transient(retry_sleeps: list[float]) -> None:
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429)

    assert _chase(handler).outcome == "transient_failure"
    assert len(calls) == retry.ATTEMPTS
    assert retry_sleeps == list(retry.BACKOFF_S)


def test_a_throttled_embed_that_clears_is_chased(retry_sleeps: list[float]) -> None:
    calls: list[int] = []
    page = _page(_video_post())

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, text=page) if calls[1:] else httpx.Response(429)

    assert _chase(handler).outcome == "chased"
    assert retry_sleeps == [retry.BACKOFF_S[0]]


@pytest.mark.parametrize(
    "page,status",
    [
        ("<html><body>no state here</body></html>", 200),  # missing JSON block
        ('<script id="__FRONTITY_CONNECT_STATE__">{not json</script>', 200),
        (_page({}), 200),  # empty videoData
        (_page(None), 200),
        (_page(_video_post(), post_id="7400000000000000999"), 200),  # another post's state
        (_page(_video_post(), statusCode=10204), 200),  # private or removed
        (_page({**_video_post(), "statusCode": 10216}), 200),
        (_page({"itemInfos": {"video": {"urls": []}}}), 200),  # no date, no media
        ("", 302),  # a redirect to the login page
        ("", 404),
    ],
)
def test_an_unreadable_embed_is_not_accessible(page: str, status: int) -> None:
    assert _chase(_embed_handler(page, status=status)).outcome == "not_accessible"


def test_a_non_tiktok_link_is_no_target_and_never_fetched() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("a non-TikTok link must never be fetched")

    assert _chase(handler, "https://example.com/video").outcome == "no_target"


def test_the_dispatcher_hands_a_tiktok_link_to_its_chaser() -> None:
    client = _client(_embed_handler(_page(_video_post())))
    try:
        result = chase_post(_POST, client=client)
    finally:
        client.close()
    assert result.outcome == "chased"
