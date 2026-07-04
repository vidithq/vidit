"""`POST /geolocations/import-from-tweet` (+ its media proxy).

The human pre-fill path: parsed-payload happy path, the no-persist detection
preview, the 400/404/502 error mapping, and the media-proxy host/size guards.
Shared fixtures live in `conftest.py`; `client` / `_make_geo` in `_helpers.py`.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from app.models.event import Event
from tests.conftest import login_as
from tests.events._helpers import client

# ── POST /geolocations/import-from-tweet ──────────────────────────────────


def _stub_parse_tweet(monkeypatch, *, returns=None, raises=None, detections=None):
    """Replace ``parse_tweet`` + ``preview_detection`` on the router module.

    Routes call both for ``import-from-tweet`` (the human pre-fill and the
    machine preview over the same cached tweet), so both are patched at the
    router module's binding to keep the test off the network.
    """
    from app.routers.events import import_tweet as geolocations_router

    def fake(url, *, client=None):
        if raises is not None:
            raise raises
        return returns

    def fake_preview(url, *, client=None):
        if raises is not None:
            raise raises
        return detections or []

    monkeypatch.setattr(geolocations_router, "parse_tweet", fake)
    monkeypatch.setattr(geolocations_router, "preview_detection", fake_preview)


def test_import_from_tweet_requires_auth():
    response = client.post(
        "/api/v1/events/import-from-tweet",
        json={"url": "https://x.com/handle/status/1234567890"},
    )
    assert response.status_code == 401


def test_import_from_tweet_returns_parsed_payload(author, monkeypatch):
    from app.services.tweet_ingest import ParsedCoord, ParsedMedia, ParsedTweet

    _stub_parse_tweet(
        monkeypatch,
        returns=ParsedTweet(
            source_url="https://x.com/handle/status/1234567890",
            original_tweet_url="https://x.com/handle/status/1234567890",
            posted_at="2025-11-12T14:33:00.000Z",
            author_handle="handle",
            tweet_text="Strike at 48.012345, 37.802411",
            suggested_title="Strike at 48.012345, 37.802411",
            parsed_coords=[ParsedCoord(lat=48.012345, lng=37.802411)],
            media=[
                ParsedMedia(
                    kind="image",
                    remote_url="https://pbs.twimg.com/media/foo.jpg",
                    content_type="image/jpeg",
                    origin="op",
                )
            ],
            quoted_tweet=None,
        ),
    )
    response = client.post(
        "/api/v1/events/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/1234567890"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source_url"] == "https://x.com/handle/status/1234567890"
    assert body["author_handle"] == "handle"
    assert body["suggested_title"].startswith("Strike")
    assert body["parsed_coords"] == [{"lat": 48.012345, "lng": 37.802411}]
    assert body["media"][0]["remote_url"].startswith("https://pbs.twimg.com/")


def test_import_from_tweet_surfaces_detection_preview_without_persisting(author, monkeypatch, db):
    from app.services.tweet_ingest import DetectedGeoloc, ParsedCoord, ParsedMedia, ParsedTweet

    before = db.query(Event).count()
    _stub_parse_tweet(
        monkeypatch,
        returns=ParsedTweet(
            source_url="https://x.com/handle/status/1",
            original_tweet_url="https://x.com/handle/status/1",
            posted_at="2025-11-12T14:33:00.000Z",
            author_handle="handle",
            tweet_text="Strike at 48.012345, 37.802411",
            suggested_title="Strike",
            parsed_coords=[],
            media=[],
            quoted_tweet=None,
        ),
        detections=[
            DetectedGeoloc(
                coordinate=ParsedCoord(lat=48.012345, lng=37.802411),
                title="Strike",
                proof_text="Strike",
                detected_from_url="https://x.com/handle/status/1",
                owner_handle="handle",
                event_date=date(2025, 11, 12),
                posted_at=datetime(2025, 11, 12, 14, 33, tzinfo=UTC),
                detected_post_at=datetime(2025, 11, 12, 14, 33, tzinfo=UTC),
                media=[
                    ParsedMedia(
                        kind="image",
                        remote_url="https://pbs.twimg.com/media/x.jpg",
                        content_type="image/jpeg",
                    )
                ],
            )
        ],
    )
    response = client.post(
        "/api/v1/events/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/1"},
    )
    assert response.status_code == 200, response.text
    detected = response.json()["detected"]
    assert len(detected) == 1
    assert detected[0]["lat"] == 48.012345
    assert detected[0]["detected_from_url"] == "https://x.com/handle/status/1"
    assert detected[0]["media"][0]["remote_url"].startswith("https://pbs.twimg.com/")
    # The preview never persists — the strongest no-write guard.
    assert db.query(Event).count() == before


def test_import_from_tweet_returns_400_for_invalid_url(author, monkeypatch):
    from app.services.tweet_ingest import InvalidTweetUrl

    _stub_parse_tweet(monkeypatch, raises=InvalidTweetUrl("Not a tweet URL"))
    response = client.post(
        "/api/v1/events/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://example.com"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Not a tweet URL"


def test_import_from_tweet_returns_404_for_inaccessible_tweet(author, monkeypatch):
    from app.services.tweet_ingest import TweetNotAccessible

    _stub_parse_tweet(monkeypatch, raises=TweetNotAccessible("Tweet not accessible"))
    response = client.post(
        "/api/v1/events/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/9999999999"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Tweet not accessible"


def test_import_from_tweet_returns_502_on_syndication_failure(author, monkeypatch):
    from app.services.tweet_ingest import TweetFetchFailed

    _stub_parse_tweet(monkeypatch, raises=TweetFetchFailed("upstream timeout"))
    response = client.post(
        "/api/v1/events/import-from-tweet",
        headers=login_as(client, author),
        json={"url": "https://x.com/handle/status/1234567890"},
    )
    assert response.status_code == 502
    # The graceful banner string the frontend renders verbatim: the
    # transport detail is hidden behind it so a syndication outage and
    # a schema-drift bug are operationally identical to the caller.
    assert response.json()["detail"] == "Couldn't read tweet, fill the form manually"


# ── GET /geolocations/import-from-tweet/media ─────────────────────────────


def test_import_from_tweet_media_requires_auth():
    response = client.get(
        "/api/v1/events/import-from-tweet/media",
        params={"u": "https://pbs.twimg.com/media/foo.jpg"},
    )
    assert response.status_code == 401


def test_import_from_tweet_media_rejects_non_twitter_host(author):
    """SSRF guard: only ``pbs.twimg.com`` / ``video.twimg.com`` are
    fetchable through the proxy."""
    login_as(client, author)
    response = client.get(
        "/api/v1/events/import-from-tweet/media",
        params={"u": "https://evil.example.com/foo.jpg"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "URL host not allowed"


def test_import_from_tweet_media_aborts_above_size_cap(author, monkeypatch):
    """A hostile / buggy upstream that streams past the cap must be
    rejected mid-stream — not allowed to OOM the worker by buffering
    the full body and then checking the size.

    Patches ``httpx.stream`` with a mock that yields chunks summing to
    well past the cap. The mock counts how many bytes it actually
    emitted; the assert checks the route consumed less than the full
    body (i.e. the streaming abort fired). Without the byte-counter
    check, the previous buffered implementation would *also* pass
    this test — the cap check would just run after the full body
    landed, hiding the regression we're guarding against.
    """
    import httpx

    from app.routers.events import import_tweet as geolocations_router

    cap = geolocations_router._MEDIA_PROXY_MAX_BYTES
    chunk_size = max(1, cap // 4)
    # Total body is 10× the cap so a buffered implementation would
    # land all of it in memory before the size check fires.
    total_body = cap * 10
    yielded_bytes = 0

    class _MockStream:
        status_code = 200
        headers = {"content-type": "video/mp4"}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def iter_bytes(self):
            nonlocal yielded_bytes
            remaining = total_body
            while remaining > 0:
                step = min(chunk_size, remaining)
                yielded_bytes += step
                yield b"\x00" * step
                remaining -= step

    monkeypatch.setattr(httpx, "stream", lambda *a, **kw: _MockStream())

    login_as(client, author)
    response = client.get(
        "/api/v1/events/import-from-tweet/media",
        params={"u": "https://pbs.twimg.com/media/foo.jpg"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Media exceeded size cap"
    # The crux: the loop must have stopped early, not consumed the
    # full body. ``cap + chunk_size`` is the worst case under correct
    # streaming behaviour (cap detected on the chunk that crosses
    # it). Anything close to ``total_body`` means the route reverted
    # to the buffered-then-check anti-pattern.
    assert yielded_bytes < total_body, (
        f"route consumed the full {total_body}-byte body before bailing — streaming abort regressed"
    )
    assert yielded_bytes <= cap + chunk_size, (
        f"route consumed {yielded_bytes} bytes; expected ≤ {cap + chunk_size} "
        f"(cap + one chunk to detect the overrun)"
    )


def test_import_from_tweet_media_rejects_giant_content_length_upfront(author, monkeypatch):
    """Advertised ``Content-Length`` over the cap → 502 without opening
    the body stream (cheap pre-check)."""
    import httpx

    from app.routers.events import import_tweet as geolocations_router

    cap = geolocations_router._MEDIA_PROXY_MAX_BYTES

    class _MockStream:
        status_code = 200
        headers = {"content-type": "video/mp4", "content-length": str(cap + 1)}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def iter_bytes(self):
            raise AssertionError("body stream must not be read after a giant content-length")

    monkeypatch.setattr(httpx, "stream", lambda *a, **kw: _MockStream())

    login_as(client, author)
    response = client.get(
        "/api/v1/events/import-from-tweet/media",
        params={"u": "https://pbs.twimg.com/media/foo.jpg"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Media exceeded size cap"


def test_media_proxy_does_not_follow_redirects(author, monkeypatch):
    """SSRF guard: ``is_trusted_media_url`` only vets the first hop, so the proxy
    must refuse to chase a 3xx to an unvetted host. Locks ``follow_redirects``
    off so a revert can't silently reopen the bypass."""
    import httpx

    captured = {}

    class _Ok:
        status_code = 200
        headers = {"content-type": "image/jpeg"}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def iter_bytes(self):
            yield b"x"

    def _capture_stream(method, url, **kwargs):
        captured.update(kwargs)
        return _Ok()

    monkeypatch.setattr(httpx, "stream", _capture_stream)

    login_as(client, author)
    response = client.get(
        "/api/v1/events/import-from-tweet/media",
        params={"u": "https://pbs.twimg.com/media/foo.jpg"},
    )
    assert response.status_code == 200
    assert captured.get("follow_redirects") is False
