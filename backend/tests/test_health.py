from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_endpoint_accepts_head():
    # Uptime monitors default to HEAD; without an explicit method registration
    # the bare @app.get(...) returned 405 and dashboards read "down" while the
    # endpoint was actually healthy on GET.
    response = client.head("/health")
    assert response.status_code == 200
    # RFC 7231: HEAD MUST NOT include a body — Starlette strips it.
    assert response.content == b""


def test_oversized_content_length_returns_413():
    """The body-size middleware rejects a POST whose announced
    ``Content-Length`` exceeds the largest legitimate payload. Without
    this guard Starlette buffers the entire multipart body to a
    ``SpooledTemporaryFile`` before any route handler runs, so per-file
    size caps in ``services/storage.validate_file`` are advisory rather
    than protective.
    """
    # 1 GiB — comfortably above the configured cap.
    response = client.post(
        "/api/v1/auth/login",
        data=b"",
        headers={"Content-Length": str(1024 * 1024 * 1024)},
    )
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_dev_staging_upload_admits_archive_sized_bodies():
    """The dev staging upload stands in for the direct-to-S3 archive POST
    that bypasses the API in prod, so the body-size middleware exempts it
    up to the archive cap (a real 772 MB export 413'd here before this
    carve-out). The middleware must pass a large announced body on that
    one path (the request then fails in the route on the missing form,
    not at the HTTP layer) while the same length still 413s elsewhere,
    and anything above the archive cap still 413s on the dev path too.
    """
    from app.main import _MAX_REQUEST_BODY_BYTES
    from app.services.storage import DEV_STAGING_UPLOAD_PATH
    from app.services.tweet_ingest import archive_zip

    large = str(_MAX_REQUEST_BODY_BYTES + 1)
    passed = client.post(DEV_STAGING_UPLOAD_PATH, data=b"", headers={"Content-Length": large})
    assert passed.status_code != 413

    elsewhere = client.post("/api/v1/auth/login", data=b"", headers={"Content-Length": large})
    assert elsewhere.status_code == 413

    beyond_archive_cap = str(archive_zip.MAX_UPLOAD_BYTES + (10 * 1024 * 1024) + 1)
    rejected = client.post(
        DEV_STAGING_UPLOAD_PATH, data=b"", headers={"Content-Length": beyond_archive_cap}
    )
    assert rejected.status_code == 413


def test_negative_content_length_returns_413():
    """Negative ``Content-Length`` must be rejected at the middleware
    layer too. ``int("-1") > _MAX_REQUEST_BODY_BYTES`` is False, so a
    pure-``>`` check would slip the negative value past the gate and
    defer rejection to Starlette's downstream parsing. The middleware's
    contract is "every Content-Length is sane *or* we reject" — locking
    the negative-guard in here so a future ``>=`` cleanup doesn't quietly
    re-open the bypass (caught in PR #100 review round 3).
    """
    response = client.post(
        "/api/v1/auth/login",
        data=b"",
        headers={"Content-Length": "-1"},
    )
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_body_size_cap_admits_full_geolocation_batch():
    """The cap must admit the LARGEST legitimate submit: one source video at
    ``max_video_size`` plus a full ``max_proof_images_per_event`` proof batch
    at ``max_image_size`` each, riding the same multipart request.
    An earlier cap shape (``max_video_size + 10 MB``) silently 413'd a
    legitimate full-image submission (caught in PR #100 review). Locks in the
    bound so a future regression (e.g. lowering ``max_image_size`` then
    raising ``max_proof_images_per_event``) doesn't reintroduce it.
    """
    from app.config import settings
    from app.main import _MAX_REQUEST_BODY_BYTES

    largest_legitimate_submit = (
        settings.max_video_size + settings.max_proof_images_per_event * settings.max_image_size
    )
    assert largest_legitimate_submit <= _MAX_REQUEST_BODY_BYTES


def test_413_response_carries_cors_headers():
    """The 413 short-circuit must traverse CORS on the way back out so a
    cross-origin browser POST that trips the cap sees a clean 413 (with
    ``Access-Control-Allow-Origin``) instead of a CORS error in DevTools.
    Achieved by ordering BodySizeLimit *inside* CORS in the middleware
    stack — caught in PR #100 review when the middleware was first
    outside CORS."""
    response = client.post(
        "/api/v1/auth/login",
        data=b"",
        headers={
            "Content-Length": str(1024 * 1024 * 1024),
            "Origin": "http://localhost:3000",
        },
    )
    assert response.status_code == 413
    # Starlette's CORSMiddleware echoes the request Origin when it
    # matches the allowlist. The localhost regex in the dev default
    # accepts every ``localhost:<port>`` — adjust if that ever tightens.
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_chunked_oversized_body_returns_413():
    """A length-less (``Transfer-Encoding: chunked``) body must 413 once its
    running total crosses the cap, the fall-through a ``Content-Length``-only
    check would miss entirely. Sent as a generator so httpx streams it with
    no announced length."""
    from app.main import _MAX_REQUEST_BODY_BYTES

    total = _MAX_REQUEST_BODY_BYTES + 1
    chunk = b"x" * (1024 * 1024)

    def _chunks():
        remaining = total
        while remaining > 0:
            step = min(len(chunk), remaining)
            yield chunk[:step]
            remaining -= step

    response = client.post("/api/v1/auth/login", content=_chunks())
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_chunked_small_body_is_not_rejected():
    """The streaming cap must not break an ordinary, well-under-the-cap
    request sent without a ``Content-Length`` header: the route must see the
    real replayed body, not an empty one.

    A schema-valid login body (unknown ``email`` + wrong password) is used on
    purpose: it returns 401 only if the route actually parsed the body. An
    empty or dropped body would fail ``LoginRequest`` validation with 422, so
    asserting 401 proves the middleware replayed the streamed bytes intact."""

    def _chunks():
        yield b'{"email": "nobody@example.com", "password": "wrong-password"}'

    response = client.post(
        "/api/v1/auth/login",
        content=_chunks(),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 401


def test_nosniff_header_present_on_normal_response():
    """Every response carries ``X-Content-Type-Options: nosniff`` so a
    mislabeled body (a stored MIME that drifted, an error page requested as
    a script) is never sniffed and executed by the browser."""
    response = client.get("/health")
    assert response.headers.get("x-content-type-options") == "nosniff"


def test_openapi_schema_is_served():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "Vidit API"
    assert "/health" in schema["paths"]
