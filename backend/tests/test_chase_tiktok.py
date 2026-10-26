"""Unit tests for the TikTok chaser (offline): the URL gates, the short link redirect read and
the embed parser over a synthetic ``__FRONTITY_CONNECT_STATE__`` page."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.services.tweet_ingest import retry
from app.services.tweet_ingest.chase.tiktok import chase
from app.services.tweet_ingest.records import ChaseResult
from app.services.tweet_ingest.urls import is_importable_link, tiktok_post_id, tiktok_short_url

_ID = "7400000000000000001"
_POST = f"https://www.tiktok.com/@someone/video/{_ID}"
_EMBED = f"https://www.tiktok.com/embed/v2/{_ID}"
_SHORT = "https://vm.tiktok.com/ZMabc123/"
_VIDEO = f"https://v19.tiktokcdn-us.com/abc/{_ID}.mp4?x-expires=1"
_IMAGES = [f"https://p16-sign.tiktokcdn.com/obj/photo{n}.jpeg" for n in (1, 2, 3)]
_CREATED = 1772630400  # 2026-03-04T13:20:00Z


@pytest.mark.parametrize(
    "url,post_id,short_url",
    [
        (_POST, _ID, None),
        (f"https://m.tiktok.com/@some.one_2/video/{_ID}/", _ID, None),
        (f"https://tiktok.com/@someone/photo/{_ID}?is_from_webapp=1", _ID, None),
        (f"http://WWW.TIKTOK.COM/@someone/video/{_ID}", _ID, None),
        (_SHORT, None, _SHORT),
        ("http://vt.tiktok.com/ZSxyz", None, "https://vt.tiktok.com/ZSxyz/"),
        ("https://tiktok.com/t/ZTcode9", None, "https://www.tiktok.com/t/ZTcode9/"),
        ("https://www.tiktok.com/@someone", None, None),  # profile
        (_EMBED, None, None),  # the embed is fetched, never pasted
        ("https://www.tiktok.com/@someone/video/notanumber", None, None),
        (f"https://tiktok.com.evil.example/@someone/video/{_ID}", None, None),
        (f"https://user:pass@www.tiktok.com/@someone/video/{_ID}", None, None),
        (f"https://www.tiktok.com:8443/@someone/video/{_ID}", None, None),
        ("https://vm.tiktok.com/", None, None),
        ("https://vm.tiktok.com/a/b", None, None),
        ("https://evil.tiktok.com/ZMabc123/", None, None),
        ("not a url", None, None),
    ],
)
def test_the_url_gates(url: str, post_id: str | None, short_url: str | None) -> None:
    assert (tiktok_post_id(url), tiktok_short_url(url)) == (post_id, short_url)
    assert is_importable_link(url) is (post_id is not None or short_url is not None)


def _page(video_data: Any, *, post_id: str = _ID, **entry: Any) -> str:
    state = {"source": {"data": {f"/embed/v2/{post_id}": {"videoData": video_data, **entry}}}}
    return f'<script id="__FRONTITY_CONNECT_STATE__" type="application/json">{json.dumps(state)}</script>'


def _video_post(video: str = _VIDEO) -> dict[str, Any]:
    return {
        "itemInfos": {"createTime": str(_CREATED), "video": {"urls": [video]}},
        "musicInfos": {"playUrl": ["https://sf16.tiktokcdn-eu.com/music.mp3"]},
    }


_PHOTO_POST = {
    "itemInfos": {"createTime": _CREATED, "video": {"urls": []}},
    "imagePostInfo": {"displayImages": [{"urlList": [url, url + "?alt"]} for url in _IMAGES]},
}

Answer = Callable[[], httpx.Response]


def _ok(page: str) -> Answer:
    return lambda: httpx.Response(200, text=page)


def _chase(answers: dict[str, Answer], target: str = _POST) -> tuple[ChaseResult, list[str]]:
    """Chase ``target`` with each fetched URL answered from ``answers``; also the URLs fetched."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return answers[str(request.url)]()

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return chase(target, client=client), seen


@pytest.mark.parametrize(
    "data,media",
    [
        (_video_post(), [("video", _VIDEO)]),
        (_PHOTO_POST, [("image", url) for url in _IMAGES]),
        (_video_post("https://tiktokcdn-eu.com.evil.example/a.mp4"), []),  # untrusted, dropped
    ],
)
def test_the_embed_yields_the_date_and_the_served_media(
    data: dict[str, Any], media: list[tuple[str, str]]
) -> None:
    result, _ = _chase({_EMBED: _ok(_page(data))})
    assert result.outcome == "chased" and result.post is not None
    assert (result.post.url, result.post.posted_at) == (_POST, "2026-03-04T13:20:00+00:00")
    assert [(m.kind, m.remote_url) for m in result.post.media] == media
    assert all(m.origin == "quote" for m in result.post.media)


def test_a_short_link_reads_its_redirect_once() -> None:
    redirect = httpx.Response(302, headers={"Location": f"{_POST}?_t=abc&_r=1"})
    result, seen = _chase({_SHORT: lambda: redirect, _EMBED: _ok(_page(_video_post()))}, _SHORT)
    # The target as written, so the resolution matches it back to the declared link.
    assert result.post is not None and result.post.url == _SHORT
    assert seen == [_SHORT, _EMBED]


@pytest.mark.parametrize(
    "status,location",
    [
        (302, "https://evil.example/@someone/video/1"),  # off-site
        (302, f"https://tiktok.com.evil.example/@someone/video/{_ID}"),  # look-alike
        (302, "https://www.tiktok.com/login?redirect_url=x"),  # no post
        (302, f"/@someone/video/{_ID}"),  # relative
        (200, None),  # no redirect
    ],
)
def test_a_short_link_that_names_no_post_is_refused(status: int, location: str | None) -> None:
    headers = {"Location": location} if location else {}
    result, seen = _chase({_SHORT: lambda: httpx.Response(status, headers=headers)}, _SHORT)
    assert result.outcome == "not_accessible"
    assert seen == [_SHORT]


def test_a_throttled_embed_is_retried_then_transient(retry_sleeps: list[float]) -> None:
    result, seen = _chase({_EMBED: lambda: httpx.Response(429)})
    assert result.outcome == "transient_failure"
    assert len(seen) == retry.ATTEMPTS
    assert retry_sleeps == list(retry.BACKOFF_S)


@pytest.mark.parametrize(
    "status,page",
    [
        (200, "<html><body>no state here</body></html>"),
        (200, '<script id="__FRONTITY_CONNECT_STATE__">{not json</script>'),
        (200, _page({})),  # empty videoData
        (200, _page(_video_post(), post_id="7400000000000000999")),  # another post's state
        (200, _page(_video_post(), statusCode=10204)),  # private or removed
        (200, _page({**_video_post(), "statusCode": 10216})),
        (200, _page({"itemInfos": {"video": {"urls": []}}})),  # no date, no media
        (302, ""),  # a redirect to the login page
    ],
)
def test_an_unreadable_embed_is_not_accessible(status: int, page: str) -> None:
    result, _ = _chase({_EMBED: lambda: httpx.Response(status, text=page)})
    assert result.outcome == "not_accessible"


def test_a_non_tiktok_link_is_no_target_and_never_fetched() -> None:
    result, seen = _chase({}, "https://example.com/video")
    assert result.outcome == "no_target"
    assert seen == []
