"""``POST /uploads/from-link``: a post link's file, staged as ``POST /uploads`` stages a picked one.

Offline: every upstream answers through one ``httpx.MockTransport`` handler routed by host.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from types import SimpleNamespace

import httpx
import pytest

import app.services.tweet_ingest.archive as archive_mod
from app.config import settings
from app.services import uploads as uploads_service
from app.services.tweet_ingest.syndication import _cache_clear
from tests._fixtures import TINY_JPEG, TINY_MP4, stored_path
from tests.conftest import login_as
from tests.events._helpers import (
    client,
    proof_file_part,
    proof_form_field,
    source_spec,
    sources_field,
    stage_file,
)

Handler = Callable[[httpx.Request], httpx.Response]

_SYNDICATION = "cdn.syndication.twimg.com"
_STATUS_URL = "https://x.com/someone/status/1790000000000000000"
_TELEGRAM_URL = "https://t.me/somechannel/12345"
_TIKTOK_ID = "7400000000000000001"
_TIKTOK_URL = f"https://www.tiktok.com/@someone/video/{_TIKTOK_ID}"
_CDN_HOSTS = ("pbs.twimg.com", "video.twimg.com", "cdn4.cdn-telegram.org", "v16m.tiktokcdn-eu.com")

_PHOTO = {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/strike.jpg"}
_VARIANT = {"content_type": "video/mp4", "url": "https://video.twimg.com/vid/strike.mp4"}
_VIDEO = {"type": "video", "video_info": {"variants": [_VARIANT]}}


def _answer(status: int = 200, **kwargs) -> Handler:
    return lambda _request: httpx.Response(status, **kwargs)


def _syndication(*media: dict[str, object]) -> Handler:
    return _answer(
        json={
            "__typename": "Tweet",
            "id_str": "1790000000000000000",
            "text": "footage",
            "created_at": "2026-03-04T13:20:00.000Z",
            "user": {"screen_name": "someone"},
            "mediaDetails": list(media),
        }
    )


def _telegram(media_html: str) -> Handler:
    return _answer(
        text=f'<div class="tgme_widget_message">{media_html}'
        '<time datetime="2026-03-04T13:20:00+00:00"></time></div>'
    )


_TELEGRAM_VIDEO = _telegram('<video src="https://cdn4.cdn-telegram.org/file/video1.mp4"></video>')
_TELEGRAM_SENSITIVE = _telegram(
    '<div class="message_media_not_supported">Please open Telegram to view this post</div>'
)


def _tiktok() -> Handler:
    video = {"urls": [f"https://v16m.tiktokcdn-eu.com/v/{_TIKTOK_ID}.mp4"]}
    data = {"itemInfos": {"createTime": "1772630400", "video": video}}
    state = {"source": {"data": {f"/embed/v2/{_TIKTOK_ID}": {"videoData": data}}}}
    return _answer(text=f'<script id="__FRONTITY_CONNECT_STATE__">{json.dumps(state)}</script>')


def _cdn(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=TINY_MP4 if request.url.path.endswith(".mp4") else TINY_JPEG)


@pytest.fixture
def upstream(monkeypatch) -> Iterator[SimpleNamespace]:
    """Route every outgoing fetch by host to ``routes``; any other host fails the test."""
    routes: dict[str, Handler] = dict.fromkeys(_CDN_HOSTS, _cdn)
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        route = routes.get(request.url.host)
        if route is None:
            raise AssertionError(f"unexpected fetch of {request.url}")
        return route(request)

    transport = httpx.MockTransport(handler)
    real_sync, real_async = httpx.Client, httpx.AsyncClient
    monkeypatch.setattr(httpx, "Client", lambda **_kw: real_sync(transport=transport))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kw: real_async(transport=transport))
    _cache_clear()
    yield SimpleNamespace(routes=routes, seen=seen)
    _cache_clear()


def _import(user, url: str, **extra) -> httpx.Response:
    return client.post(
        "/api/v1/uploads/from-link", headers=login_as(client, user), json={"url": url, **extra}
    )


def test_an_x_post_file_is_staged_like_an_upload_and_taken_by_the_event_write(
    upstream, author, conflict
):
    upstream.routes[_SYNDICATION] = _syndication(_PHOTO)
    response = _import(author, _STATUS_URL)
    assert response.status_code == 201, response.text
    staged = response.json()
    assert staged["kind"] == "image" and staged["post_media"] == ["image"]
    assert staged["original_filename"] is None
    key = staged["storage_url"].split("/local-storage/", 1)[1]
    assert stored_path(key).exists()
    # A source image gets its derivatives, as one uploaded through the form.
    assert stored_path(key.replace(".jpg", "_thumb.jpg")).exists()

    response = client.post(
        "/api/v1/events",
        headers=login_as(client, author),
        data={
            "title": "Strike",
            "lat": "48.5",
            "lng": "34.5",
            "occurred_date": "2026-05-01",
            "proof": proof_form_field(),
            "conflict_ids": f'["{conflict.id}"]',
            "sources": sources_field(source_spec(_STATUS_URL, upload_id=staged["id"])),
        },
        files=[proof_file_part()],
    )
    assert response.status_code == 201, response.text
    assert response.json()["sources"][0]["media"]["storage_url"] == staged["storage_url"]


@pytest.mark.parametrize(
    "host,route,url,index,kind,post_media",
    [
        ("t.me", _TELEGRAM_VIDEO, _TELEGRAM_URL, 0, "video", ["video"]),
        ("www.tiktok.com", _tiktok(), _TIKTOK_URL, 0, "video", ["video"]),
        (_SYNDICATION, _syndication(_PHOTO, _VIDEO), _STATUS_URL, 1, "video", ["image", "video"]),
    ],
    ids=["telegram", "tiktok", "x-index"],
)
def test_the_file_at_the_index_is_staged(
    upstream, author, host, route, url, index, kind, post_media
):
    upstream.routes[host] = route
    response = _import(author, url, index=index)
    assert response.status_code == 201, response.text
    assert (response.json()["kind"], response.json()["post_media"]) == (kind, post_media)
    assert "pbs.twimg.com" not in upstream.seen


_X_PHOTO = {_SYNDICATION: _syndication(_PHOTO)}
_TG_VIDEO = {"t.me": _TELEGRAM_VIDEO}
_TG_CDN = "cdn4.cdn-telegram.org"


@pytest.mark.parametrize(
    "url,routes,index,status,code",
    [
        (_STATUS_URL, _X_PHOTO, 1, 404, "link_has_no_file"),
        (_TELEGRAM_URL, {"t.me": _TELEGRAM_SENSITIVE}, 0, 404, "link_has_no_file"),
        (_STATUS_URL, {_SYNDICATION: _answer(404, json={})}, 0, 404, "link_not_accessible"),
        (_STATUS_URL, {**_X_PHOTO, "pbs.twimg.com": _answer(403)}, 0, 404, "link_not_accessible"),
        (_STATUS_URL, {_SYNDICATION: _answer(429, json={})}, 0, 503, "upstream_busy"),
        (_TELEGRAM_URL, {**_TG_VIDEO, _TG_CDN: _answer(503)}, 0, 503, "upstream_busy"),
    ],
)
def test_a_post_whose_file_cannot_be_staged_is_refused(
    upstream, author, url, routes, index, status, code
):
    upstream.routes.update(routes)
    response = _import(author, url, index=index)
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/video.mp4",
        "https://t.me/c/1234567890/42",
        "http://169.254.169.254/latest/meta-data",
        "https://x.com/someone",
    ],
)
def test_an_unsupported_link_is_refused_without_a_fetch(upstream, author, url):
    response = _import(author, url)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "unsupported_link"
    assert upstream.seen == []


@pytest.mark.parametrize(
    "target,attr,value",
    [(settings, "max_image_size", len(TINY_JPEG) - 1), (archive_mod, "MEDIA_FETCH_MAX_BYTES", 8)],
    ids=["upload-limit", "fetch-cap"],
)
def test_a_file_over_a_size_limit_is_refused(upstream, author, monkeypatch, target, attr, value):
    monkeypatch.setattr(target, attr, value)
    upstream.routes.update(_X_PHOTO)
    response = _import(author, _STATUS_URL)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_file"


def test_the_staged_file_cap_holds_before_any_fetch(upstream, author, monkeypatch):
    monkeypatch.setattr(uploads_service, "MAX_PENDING_UPLOADS_PER_USER", 1)
    stage_file(author)
    response = _import(author, _STATUS_URL)
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "too_many_uploads"
    assert upstream.seen == []
