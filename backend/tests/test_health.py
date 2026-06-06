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
    """The cap must admit the LARGEST legitimate submit: a full batch of
    ``MAX_FILES_PER_GEOLOCATION`` images at ``max_image_size`` each.
    Previously the cap was ``max_video_size + 10 MB`` = 110 MB, which
    silently 413'd a legitimate 12-image submission totalling 120 MB +
    multipart framing (caught in PR #100 review). Locks in the bound
    so a future regression — e.g. lowering ``max_image_size`` then
    raising ``MAX_FILES_PER_GEOLOCATION`` — doesn't reintroduce it.
    """
    from app.config import settings
    from app.main import _MAX_REQUEST_BODY_BYTES

    largest_legitimate_image_batch = settings.max_files_per_geolocation * settings.max_image_size
    assert largest_legitimate_image_batch <= _MAX_REQUEST_BODY_BYTES
    assert settings.max_video_size <= _MAX_REQUEST_BODY_BYTES


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


def test_openapi_schema_is_served():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "Vidit API"
    assert "/health" in schema["paths"]
