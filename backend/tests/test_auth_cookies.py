import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.user import User
from app.services.auth import create_access_token, hash_password
from app.services.auth_cookies import (
    CSRF_COOKIE,
    CSRF_HEADER,
    SESSION_COOKIE,
)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def user_with_password(db):
    password = "correct-horse-battery-staple"
    # ``example.com`` (not ``.test``): pydantic's EmailStr backend rejects
    # the latter at request-validation time as "reserved", and we need the
    # email to round-trip through /login.
    user = User(
        username=f"cookie-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash=hash_password(password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    yield user, password
    db.delete(user)
    db.commit()


def _client() -> TestClient:
    # Each test gets a fresh client so cookie jars don't leak across tests.
    return TestClient(app)


def test_login_sets_session_and_csrf_cookies(user_with_password):
    user, password = user_with_password
    client = _client()
    response = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == user.email
    assert "access_token" not in body  # JWT no longer leaks into the body
    assert SESSION_COOKIE in response.cookies
    assert CSRF_COOKIE in response.cookies


def test_me_with_session_cookie_works(user_with_password):
    user, password = user_with_password
    client = _client()
    client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == user.email


def test_bearer_header_ignored_on_get(user_with_password):
    """A valid JWT handed in ``Authorization: Bearer`` is ignored — the
    request is anonymous and gets 401.

    The Bearer auth path was removed when the test suite migrated to
    cookies; the cookie + CSRF pair is the only authenticated channel
    into the backend now.
    """
    user, _ = user_with_password
    token = create_access_token(user)
    client = _client()
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401


def test_me_without_credentials_returns_401():
    client = _client()
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_logout_clears_cookies(user_with_password):
    user, password = user_with_password
    client = _client()
    client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    csrf = client.cookies.get(CSRF_COOKIE)
    assert csrf is not None

    response = client.post(
        "/api/v1/auth/logout",
        headers={CSRF_HEADER: csrf},
    )
    assert response.status_code == 204

    # /me should now reject — TestClient applies the Set-Cookie deletion.
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 401


def test_csrf_blocks_cookie_auth_without_header(user_with_password):
    user, password = user_with_password
    client = _client()
    client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    # POST /logout with cookie but no X-CSRF-Token header → 403
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 403
    assert "CSRF" in response.json()["detail"]


def test_csrf_blocks_cookie_auth_with_wrong_header(user_with_password):
    user, password = user_with_password
    client = _client()
    client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    response = client.post(
        "/api/v1/auth/logout",
        headers={CSRF_HEADER: "obviously-wrong"},
    )
    assert response.status_code == 403


def test_login_works_with_stale_session_cookie(user_with_password):
    """A leftover (now-invalid) ``vidit_session`` cookie must not block login.

    Repro for the bug where a user whose JWT went stale (server restart,
    secret rotation) could never sign back in: the HTTPOnly cookie is in the
    jar, the browser keeps attaching it, the CSRF middleware would see it
    and demand a token the client doesn't have on the login form.
    """
    user, password = user_with_password
    client = _client()
    client.cookies.set(SESSION_COOKIE, "garbage-jwt-from-a-previous-life")

    response = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    assert response.status_code == 200


def test_login_ignores_csrf_header_mismatch_with_stale_cookies(user_with_password):
    """Exempt paths must bypass CSRF *even* when the request looks malicious.

    A user landing on /auth/login with a stale ``vidit_session`` and a stale
    ``vidit_csrf`` from a prior identity can't access the HTTPOnly session to
    clear it — the form submits whatever the browser auto-attaches. If the
    middleware enforced CSRF here, a header/cookie mismatch (or missing
    header) would 403 and lock the user out forever.
    """
    user, password = user_with_password
    client = _client()
    client.cookies.set(SESSION_COOKIE, "garbage-jwt-from-a-previous-life")
    client.cookies.set(CSRF_COOKIE, "old-csrf-token")

    response = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
        headers={CSRF_HEADER: "different-token-mismatch"},
    )
    assert response.status_code == 200


def test_logout_clears_cookies_with_prod_attributes(monkeypatch, user_with_password):
    """In prod (``Secure``, ``SameSite=none``) the deletion ``Set-Cookie`` must
    carry the same attributes — otherwise browsers drop the header and the
    cookie persists past logout.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "cookie_samesite", "none")

    user, password = user_with_password
    client = _client()
    client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )
    csrf = client.cookies.get(CSRF_COOKIE)
    assert csrf is not None

    response = client.post(
        "/api/v1/auth/logout",
        headers={CSRF_HEADER: csrf},
    )
    assert response.status_code == 204

    set_cookie_headers = response.headers.get_list("set-cookie")
    session_clear = next(
        (h for h in set_cookie_headers if h.startswith(f"{SESSION_COOKIE}=")),
        None,
    )
    csrf_clear = next(
        (h for h in set_cookie_headers if h.startswith(f"{CSRF_COOKIE}=")),
        None,
    )
    assert session_clear is not None and csrf_clear is not None
    for header in (session_clear, csrf_clear):
        # Browsers reject ``SameSite=None`` without ``Secure``. Both must
        # appear on the deletion header for the clear to take effect.
        assert "samesite=none" in header.lower()
        assert "secure" in header.lower()
