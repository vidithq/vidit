"""``POST /uploads/from-link``: a post link's file, staged as ``POST /uploads`` stages a picked one.

Offline: every upstream (syndication, the Telegram embed, the CDNs) answers through one
``httpx.MockTransport`` handler routed by host.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator

import httpx
import pytest

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

_STATUS_URL = "https://x.com/someone/status/1790000000000000000"
_TELEGRAM_URL = "https://t.me/somechannel/12345"
_PHOTO_URL = "https://pbs.twimg.com/media/strike.jpg"
_VIDEO_URL = "https://video.twimg.com/ext_tw_video/1/pu/vid/strike.mp4"


def _status_body(*media: dict[str, object]) -> dict[str, object]:
    return {
        "__typename": "Tweet",
        "id_str": "1790000000000000000",
        "text": "footage",
        "created_at": "2026-03-04T13:20:00.000Z",
        "user": {"screen_name": "someone"},
        "mediaDetails": list(media),
    }


_PHOTO = {"type": "photo", "media_url_https": _PHOTO_URL}
_VIDEO = {
    "type": "video",
    "video_info": {
        "variants": [{"content_type": "video/mp4", "bitrate": 832000, "url": _VIDEO_URL}]
    },
}

_TELEGRAM_VIDEO_HTML = (
    '<div class="tgme_widget_message">'
    '<video src="https://cdn4.cdn-telegram.org/file/video1.mp4"></video>'
    '<time datetime="2026-03-04T13:20:00+00:00"></time>'
    "</div>"
)
_TELEGRAM_SENSITIVE_HTML = (
    '<div class="tgme_widget_message">'
    '<div class="message_media_not_supported">Please open Telegram to view this post</div>'
    '<time datetime="2026-03-04T13:20:00+00:00"></time>'
    "</div>"
)


def _cdn(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    return httpx.Response(200, content=TINY_MP4 if path.endswith(".mp4") else TINY_JPEG)


@pytest.fixture
def upstream(monkeypatch) -> Iterator[dict[str, Handler]]:
    """Route every outgoing fetch by host to the handler the test sets; any other host fails."""
    routes: dict[str, Handler] = {
        "pbs.twimg.com": _cdn,
        "video.twimg.com": _cdn,
        "cdn4.cdn-telegram.org": _cdn,
    }
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
    routes["seen"] = seen  # type: ignore[assignment]
    yield routes
    _cache_clear()


def _syndication(body: dict[str, object] | None = None, *, status: int = 200) -> Handler:
    return lambda _request: httpx.Response(status, json=body or {})


def _import(user, url: str, **extra) -> httpx.Response:
    return client.post(
        "/api/v1/uploads/from-link", headers=login_as(client, user), json={"url": url, **extra}
    )


def _key(storage_url: str) -> str:
    return storage_url.split("/local-storage/", 1)[1]


def test_an_x_post_file_is_staged_like_an_upload(upstream, author):
    upstream["cdn.syndication.twimg.com"] = _syndication(_status_body(_PHOTO))
    response = _import(author, _STATUS_URL)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "image" and body["post_media"] == ["image"]
    assert body["original_filename"] is None
    assert stored_path(_key(body["storage_url"])).exists()
    # A source image gets its derivatives, as one uploaded through the form.
    assert stored_path(_key(body["storage_url"]).replace(".jpg", "_thumb.jpg")).exists()


def test_the_staged_file_is_taken_by_the_event_write(upstream, author, conflict):
    upstream["cdn.syndication.twimg.com"] = _syndication(_status_body(_VIDEO))
    staged = _import(author, _STATUS_URL).json()
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


def test_a_telegram_post_file_is_staged(upstream, author):
    upstream["t.me"] = lambda _request: httpx.Response(200, text=_TELEGRAM_VIDEO_HTML)
    response = _import(author, _TELEGRAM_URL)
    assert response.status_code == 201, response.text
    assert response.json()["kind"] == "video"
    assert response.json()["post_media"] == ["video"]


def test_the_index_picks_one_of_the_post_files(upstream, author):
    upstream["cdn.syndication.twimg.com"] = _syndication(_status_body(_PHOTO, _VIDEO))
    response = _import(author, _STATUS_URL, index=1)
    assert response.status_code == 201, response.text
    assert response.json()["kind"] == "video"
    assert response.json()["post_media"] == ["image", "video"]
    assert upstream["seen"].count("pbs.twimg.com") == 0  # type: ignore[union-attr]


def test_an_index_past_the_post_files_is_refused(upstream, author):
    upstream["cdn.syndication.twimg.com"] = _syndication(_status_body(_PHOTO))
    response = _import(author, _STATUS_URL, index=1)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "link_has_no_file"


def test_a_post_without_a_file_is_refused(upstream, author):
    upstream["t.me"] = lambda _request: httpx.Response(200, text=_TELEGRAM_SENSITIVE_HTML)
    response = _import(author, _TELEGRAM_URL)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "link_has_no_file"


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
    assert upstream["seen"] == []


def test_a_gone_post_is_not_accessible(upstream, author):
    upstream["cdn.syndication.twimg.com"] = _syndication(status=404)
    response = _import(author, _STATUS_URL)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "link_not_accessible"


def test_a_refused_file_is_not_accessible(upstream, author):
    upstream["cdn.syndication.twimg.com"] = _syndication(_status_body(_PHOTO))
    upstream["pbs.twimg.com"] = lambda _request: httpx.Response(403)
    response = _import(author, _STATUS_URL)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "link_not_accessible"


def test_a_throttled_post_host_is_busy(upstream, author):
    upstream["cdn.syndication.twimg.com"] = _syndication(status=429)
    response = _import(author, _STATUS_URL)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "upstream_busy"


def test_a_throttled_file_host_is_busy(upstream, author):
    upstream["t.me"] = lambda _request: httpx.Response(200, text=_TELEGRAM_VIDEO_HTML)
    upstream["cdn4.cdn-telegram.org"] = lambda _request: httpx.Response(503)
    response = _import(author, _TELEGRAM_URL)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "upstream_busy"


def test_a_file_over_the_upload_limit_is_refused(upstream, author, monkeypatch):
    monkeypatch.setattr(settings, "max_image_size", len(TINY_JPEG) - 1)
    upstream["cdn.syndication.twimg.com"] = _syndication(_status_body(_PHOTO))
    response = _import(author, _STATUS_URL)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_file"


def test_a_file_over_the_fetch_cap_is_dropped_unbuffered(upstream, author, monkeypatch):
    import app.services.tweet_ingest.archive as archive_mod

    monkeypatch.setattr(archive_mod, "MEDIA_FETCH_MAX_BYTES", 8)
    upstream["cdn.syndication.twimg.com"] = _syndication(_status_body(_VIDEO))
    response = _import(author, _STATUS_URL)
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_file"


def test_the_staged_file_cap_holds_before_any_fetch(upstream, author, monkeypatch):
    monkeypatch.setattr(uploads_service, "MAX_PENDING_UPLOADS_PER_USER", 1)
    stage_file(author)
    response = _import(author, _STATUS_URL)
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "too_many_uploads"
    assert upstream["seen"] == []
