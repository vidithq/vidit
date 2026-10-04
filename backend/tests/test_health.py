from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_endpoint_accepts_head():
    # Uptime monitors default to HEAD; a bare @app.get returned 405 and read as "down".
    response = client.head("/health")
    assert response.status_code == 200
    # RFC 7231: HEAD has no body.
    assert response.content == b""


def test_oversized_content_length_returns_413():
    """The body-size middleware rejects an announced ``Content-Length`` above the cap.

    Without it Starlette buffers the whole multipart body before any handler runs,
    so the per-file caps in ``services/storage.validate_file`` would not protect.
    """
    # 1 GiB, well above the cap.
    response = client.post(
        "/api/v1/auth/login",
        data=b"",
        headers={"Content-Length": str(1024 * 1024 * 1024)},
    )
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_dev_staging_upload_admits_archive_sized_bodies():
    """The dev staging upload stands in for the direct-to-S3 archive POST, so the
    middleware admits it up to the archive cap. A large body passes on that path
    (then fails in the route on the missing form), still 413s elsewhere, and 413s
    above the archive cap.
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
    """A negative ``Content-Length`` is rejected by the middleware: a pure ``>``
    check would pass ``-1`` through to Starlette's parsing."""
    response = client.post(
        "/api/v1/auth/login",
        data=b"",
        headers={"Content-Length": "-1"},
    )
    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_body_size_cap_admits_full_geolocation_batch():
    """The cap admits the largest legitimate submit: one source video at
    ``max_video_size`` plus a full proof-image batch at ``max_image_size`` each,
    in one multipart request."""
    from app.config import settings
    from app.main import _MAX_REQUEST_BODY_BYTES

    largest_legitimate_submit = (
        settings.max_video_size + settings.max_proof_images_per_event * settings.max_image_size
    )
    assert largest_legitimate_submit <= _MAX_REQUEST_BODY_BYTES


def test_413_response_carries_cors_headers():
    """The 413 passes back through CORS (BodySizeLimit sits inside it), so a
    cross-origin POST sees a clean 413 instead of a CORS error."""
    response = client.post(
        "/api/v1/auth/login",
        data=b"",
        headers={
            "Content-Length": str(1024 * 1024 * 1024),
            "Origin": "http://localhost:3000",
        },
    )
    assert response.status_code == 413
    # The dev default regex accepts every ``localhost:<port>``.
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_chunked_oversized_body_returns_413():
    """A chunked body with no ``Content-Length`` 413s once its running total crosses the cap."""
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
    """A small body sent without ``Content-Length`` reaches the route intact.

    The login body returns 401 only if parsed; a dropped body would 422."""

    def _chunks():
        yield b'{"email": "nobody@example.com", "password": "wrong-password"}'

    response = client.post(
        "/api/v1/auth/login",
        content=_chunks(),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 401


def test_nosniff_header_present_on_normal_response():
    """Every response carries ``X-Content-Type-Options: nosniff`` so a mislabeled body is never sniffed and executed."""
    response = client.get("/health")
    assert response.headers.get("x-content-type-options") == "nosniff"


def test_openapi_schema_is_served():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "Vidit API"
    assert "/health" in schema["paths"]
