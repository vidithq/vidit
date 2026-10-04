import uuid

import bcrypt
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
    # ``example.com``, not ``.test``: EmailStr rejects ``.test`` as reserved.
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
    """A valid JWT in ``Authorization: Bearer`` is ignored: the request is anonymous (401).
    The cookie + CSRF pair is the only authenticated channel."""
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


def test_login_answers_an_over_long_password_like_a_wrong_one(user_with_password):
    user, _ = user_with_password
    client = _client()
    wrong = client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong-pw"})
    # 40 characters, 80 bytes: past bcrypt's 72-byte input limit.
    for email in (user.email, f"nobody-{uuid.uuid4().hex}@example.com"):
        response = client.post("/api/v1/auth/login", json={"email": email, "password": "é" * 40})
        assert response.status_code == wrong.status_code == 401
        assert response.json() == wrong.json()
        assert SESSION_COOKIE not in response.cookies


def test_login_pays_one_bcrypt_check_for_an_over_long_password(monkeypatch, user_with_password):
    # One check per attempt, known account or not, keeps response time from
    # telling the two apart.
    user, _ = user_with_password
    checks: list[bytes] = []
    real_checkpw = bcrypt.checkpw

    def counting_checkpw(password: bytes, hashed: bytes) -> bool:
        checks.append(hashed)
        return real_checkpw(password, hashed)

    monkeypatch.setattr(bcrypt, "checkpw", counting_checkpw)
    client = _client()
    for email in (user.email, f"nobody-{uuid.uuid4().hex}@example.com"):
        checks.clear()
        response = client.post("/api/v1/auth/login", json={"email": email, "password": "é" * 40})
        assert response.status_code == 401
        assert len(checks) == 1


def test_login_does_not_truncate_a_password_to_72_bytes(db):
    password = "a" * 72
    user = User(
        username=f"cookie-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash=hash_password(password),
    )
    db.add(user)
    db.commit()
    try:
        client = _client()
        extended = {"email": user.email, "password": password + "b"}
        assert client.post("/api/v1/auth/login", json=extended).status_code == 401
        exact = {"email": user.email, "password": password}
        assert client.post("/api/v1/auth/login", json=exact).status_code == 200
    finally:
        db.delete(user)
        db.commit()


def test_login_answers_a_lone_surrogate_like_a_wrong_password(user_with_password):
    user, _ = user_with_password
    client = _client()
    wrong = client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong-pw"})
    # Raw JSON: the escape decodes to an unpaired surrogate that UTF-8 cannot encode.
    body = f'{{"email": "{user.email}", "password": "\\ud800"}}'
    response = client.post(
        "/api/v1/auth/login", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == wrong.status_code == 401
    assert response.json() == wrong.json()


def test_login_refuses_a_profile_without_a_password(db):
    user = User(
        username=f"cookie-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash=None,
    )
    db.add(user)
    db.commit()
    try:
        # The plaintext of the hash such a profile is checked against.
        body = {"email": user.email, "password": "dummy-password-for-timing-equalisation"}
        response = _client().post("/api/v1/auth/login", json=body)
        assert response.status_code == 401
        assert SESSION_COOKIE not in response.cookies
    finally:
        db.delete(user)
        db.commit()


def test_validation_error_does_not_echo_the_input():
    password = "pw-1234"
    response = _client().post(
        "/api/v1/auth/register",
        json={"username": "u", "email": "a@example.com", "password": password, "invite_code": "x"},
    )
    assert response.status_code == 422
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body", "password"]
    assert error["msg"]
    assert "input" not in error
    assert password not in response.text


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
    """A stale ``vidit_session`` cookie must not block login.

    Regression: the browser keeps attaching the HTTPOnly cookie and CSRF would
    demand a token the login form lacks.
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
    """Exempt paths bypass CSRF even on a header/cookie mismatch.

    A user with stale cookies from a prior identity cannot clear the HTTPOnly
    session, so enforcing CSRF here would lock them out.
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
    """In prod (``Secure``, ``SameSite=none``) the deletion ``Set-Cookie`` must carry
    the same attributes, or browsers drop it and the cookie outlives logout."""
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
        # Browsers reject ``SameSite=None`` without ``Secure``.
        assert "samesite=none" in header.lower()
        assert "secure" in header.lower()
