"""The "Continue with X" OAuth flow — ``/auth/x/*``.

Covers the protocol units (PKCE, token exchange, userinfo, signed cookies) via
``httpx.MockTransport``, and the four endpoints end-to-end by stubbing the two
network calls so the binding matrix (claim / login / link / register / conflict)
and every failure path are exercised with no real X dev-app.

The suite runs against the dev DB with hand-rolled teardown (see the repo's
*transactional test isolation* refactor): every row these tests mint carries an
``xtest`` prefix on ``username`` / ``x_handle`` and the autouse fixture purges
them (and their ``auth_events``) afterwards.
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models.auth_event import AuthEvent
from app.models.user import User
from app.services import x_oauth
from app.services.auth_cookies import SESSION_COOKIE
from tests.conftest import login_as

client = TestClient(app)

_STATE_COOKIE = "vidit_x_oauth"
_REGISTER_COOKIE = "vidit_x_register"
_PREFIX = "xtest"


# ── Fixtures + helpers ─────────────────────────────────────────────────────


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _isolate(db):
    """Fresh cookie jar per test; purge any ``xtest``-prefixed rows afterwards."""
    client.cookies.clear()
    yield
    client.cookies.clear()
    ids = [
        u.id
        for u in db.query(User)
        .filter((User.username.like(f"{_PREFIX}%")) | (User.x_handle.like(f"{_PREFIX}%")))
        .all()
    ]
    if ids:
        db.query(AuthEvent).filter(AuthEvent.user_id.in_(ids)).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


@pytest.fixture
def x_enabled(monkeypatch):
    """Light up the feature (config gate) without a real X dev-app."""
    monkeypatch.setattr(settings, "x_client_id", "test-client-id")
    monkeypatch.setattr(settings, "x_client_secret", "test-secret")
    monkeypatch.setattr(settings, "x_redirect_uri", "https://api.test/api/v1/auth/x/callback")


@pytest.fixture
def fake_x(monkeypatch):
    """Stub the two X network calls; set ``state['handle']`` to the proven handle."""
    state = {"handle": f"{_PREFIX}_default"}
    monkeypatch.setattr(x_oauth, "exchange_code", lambda **kwargs: "fake-access-token")
    monkeypatch.setattr(x_oauth, "fetch_username", lambda **kwargs: state["handle"])
    return state


def _h(label: str) -> str:
    return f"{_PREFIX}_{label}_{uuid.uuid4().hex[:8]}"


def _user(db, *, handle: str | None = None, claimed: bool = True) -> User:
    """Mint a test account.

    ``claimed=False`` forges an unclaimed assembled profile: ``x_handle`` set,
    no credentials, ``claimed_at`` NULL. The column's ``server_default=now()``
    fills on INSERT even when the attribute is None, so null it post-insert.
    """
    user = User(
        username=_h("u"),
        x_handle=handle,
        email=f"{_PREFIX}{uuid.uuid4().hex}@example.test" if claimed else None,
        password_hash="x" if claimed else None,
    )
    db.add(user)
    db.flush()
    if not claimed:
        user.claimed_at = None
        db.flush()
    db.commit()
    db.refresh(user)
    return user


def _set_state_cookie(state: str = "state-token") -> str:
    """Sign + set the PKCE state cookie on the client; return the state param."""
    client.cookies.set(_STATE_COOKIE, x_oauth.sign_state(state=state, code_verifier="verifier"))
    return state


def _callback(state_param: str, *, code: str = "auth-code"):
    return client.get(
        f"/api/v1/auth/x/callback?code={code}&state={state_param}",
        follow_redirects=False,
    )


# ── Config gate: dark unless configured ────────────────────────────────────


def test_start_503_when_disabled():
    assert client.get("/api/v1/auth/x/start", follow_redirects=False).status_code == 503


def test_callback_503_when_disabled():
    r = client.get("/api/v1/auth/x/callback?code=c&state=s", follow_redirects=False)
    assert r.status_code == 503


def test_pending_503_when_disabled():
    assert client.get("/api/v1/auth/x/pending").status_code == 503


def test_register_503_when_disabled():
    r = client.post("/api/v1/auth/x/register", json={"username": "xtest_nobody"})
    assert r.status_code == 503


# ── Protocol units (MockTransport) ─────────────────────────────────────────


def test_generate_pkce_pair_is_s256():
    verifier, challenge = x_oauth.generate_pkce_pair()
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    assert challenge == expected
    assert "=" not in challenge


def test_build_authorize_url_carries_pkce_and_scopes(x_enabled):
    url = x_oauth.build_authorize_url(state="st", code_challenge="ch")
    assert url.startswith(settings.x_authorize_url)
    assert "response_type=code" in url
    assert "code_challenge=ch" in url
    assert "code_challenge_method=S256" in url
    assert "scope=tweet.read+users.read" in url
    assert "state=st" in url


def test_exchange_code_returns_access_token():
    mock = httpx.Client(
        transport=httpx.MockTransport(
            lambda _r: httpx.Response(200, json={"access_token": "tok", "token_type": "bearer"})
        )
    )
    assert x_oauth.exchange_code(code="c", code_verifier="v", client=mock) == "tok"


def test_exchange_code_raises_on_non_2xx():
    mock = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(400, json={})))
    with pytest.raises(x_oauth.XOAuthError):
        x_oauth.exchange_code(code="c", code_verifier="v", client=mock)


def test_exchange_code_raises_when_token_absent():
    mock = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(200, json={"token_type": "bearer"}))
    )
    with pytest.raises(x_oauth.XOAuthError):
        x_oauth.exchange_code(code="c", code_verifier="v", client=mock)


def test_fetch_username_reads_handle():
    mock = httpx.Client(
        transport=httpx.MockTransport(
            lambda _r: httpx.Response(200, json={"data": {"id": "1", "username": "Alice"}})
        )
    )
    assert x_oauth.fetch_username(access_token="t", client=mock) == "Alice"


def test_fetch_username_raises_on_401():
    mock = httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(401, json={})))
    with pytest.raises(x_oauth.XOAuthError):
        x_oauth.fetch_username(access_token="t", client=mock)


def test_state_cookie_roundtrip():
    token = x_oauth.sign_state(state="abc", code_verifier="xyz")
    assert x_oauth.verify_state(token) == ("abc", "xyz")


def test_verify_state_rejects_tampered():
    with pytest.raises(x_oauth.XOAuthError):
        x_oauth.verify_state("not-a-jwt")


def test_handle_cookie_roundtrip():
    assert x_oauth.verify_handle(x_oauth.sign_handle("alice")) == "alice"


# ── start ──────────────────────────────────────────────────────────────────


def test_start_redirects_to_x_with_state_cookie(x_enabled):
    r = client.get("/api/v1/auth/x/start", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"].startswith(settings.x_authorize_url)
    assert "code_challenge_method=S256" in r.headers["location"]
    assert _STATE_COOKIE in r.cookies


# ── callback: the binding matrix ───────────────────────────────────────────


def test_callback_claims_unclaimed_profile(db, x_enabled, fake_x):
    handle = _h("claim")
    user = _user(db, handle=handle, claimed=False)
    fake_x["handle"] = handle
    state = _set_state_cookie()

    r = _callback(state)

    assert r.status_code == 307
    assert r.headers["location"].endswith(f"/profile/{user.username}/review")
    assert SESSION_COOKIE in r.cookies
    db.refresh(user)
    assert user.claimed_at is not None
    assert (
        db.query(AuthEvent)
        .filter(AuthEvent.user_id == user.id, AuthEvent.event == "x_oauth_claim")
        .count()
        == 1
    )


def test_callback_logs_in_claimed_profile(db, x_enabled, fake_x):
    handle = _h("login")
    _user(db, handle=handle, claimed=True)
    fake_x["handle"] = handle
    state = _set_state_cookie()

    r = _callback(state)

    assert r.status_code == 307
    assert r.headers["location"].endswith("/map")
    assert SESSION_COOKIE in r.cookies


def test_callback_links_handle_for_logged_in_user(db, x_enabled, fake_x):
    caller = _user(db, handle=None, claimed=True)
    handle = _h("link")
    fake_x["handle"] = handle
    login_as(client, caller)
    state = _set_state_cookie()

    r = _callback(state)

    assert r.status_code == 307
    assert r.headers["location"].endswith(f"/profile/{caller.username}")
    db.refresh(caller)
    assert caller.x_handle == handle


def test_callback_conflict_when_handle_owned_by_another(db, x_enabled, fake_x):
    handle = _h("conf")
    _user(db, handle=handle, claimed=True)  # someone else owns it
    caller = _user(db, handle=None, claimed=True)
    fake_x["handle"] = handle
    login_as(client, caller)
    state = _set_state_cookie()

    r = _callback(state)

    assert "x_error=x_handle_conflict" in r.headers["location"]
    db.refresh(caller)
    assert caller.x_handle is None  # nothing written


def test_callback_conflict_when_caller_already_has_other_handle(db, x_enabled, fake_x):
    caller = _user(db, handle=_h("owned"), claimed=True)
    fake_x["handle"] = _h("new")
    login_as(client, caller)
    state = _set_state_cookie()

    r = _callback(state)

    assert "x_error=x_handle_already_set" in r.headers["location"]


def test_callback_no_profile_hands_off_to_register(db, x_enabled, fake_x):
    fake_x["handle"] = _h("newbie")
    state = _set_state_cookie()

    r = _callback(state)

    assert r.status_code == 307
    assert r.headers["location"].endswith("/register?x=1")
    assert _REGISTER_COOKIE in r.cookies
    assert SESSION_COOKIE not in r.cookies  # no account yet → no session


def test_callback_normalizes_handle(db, x_enabled, fake_x):
    handle = _h("norm")  # lowercase
    user = _user(db, handle=handle, claimed=False)
    fake_x["handle"] = f"@{handle.upper()}"  # X returns @MixedCase
    state = _set_state_cookie()

    r = _callback(state)

    assert r.status_code == 307
    assert r.headers["location"].endswith(f"/profile/{user.username}/review")


# ── callback: failure paths ────────────────────────────────────────────────


def test_callback_state_mismatch(x_enabled, fake_x):
    _set_state_cookie("real-state")
    r = _callback("wrong-state")
    assert "x_error=invalid_state" in r.headers["location"]


def test_callback_missing_state_cookie(x_enabled, fake_x):
    r = _callback("any-state")
    assert "x_error=invalid_state" in r.headers["location"]


def test_callback_expired_state_cookie(x_enabled, fake_x):
    expired = jwt.encode(
        {"st": "s", "cv": "v", "exp": datetime.now(UTC) - timedelta(seconds=5)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    client.cookies.set(_STATE_COOKIE, expired)
    r = _callback("s")
    assert "x_error=invalid_state" in r.headers["location"]


def test_callback_token_exchange_failure(x_enabled, monkeypatch):
    def _boom(**kwargs):
        raise x_oauth.XOAuthError("boom", code="x_oauth_failed")

    monkeypatch.setattr(x_oauth, "exchange_code", _boom)
    state = _set_state_cookie()
    r = _callback(state)
    assert "x_error=x_oauth_failed" in r.headers["location"]


def test_callback_userinfo_failure(x_enabled, monkeypatch):
    def _boom(**kwargs):
        raise x_oauth.XOAuthError("boom", code="x_oauth_failed")

    monkeypatch.setattr(x_oauth, "exchange_code", lambda **kwargs: "tok")
    monkeypatch.setattr(x_oauth, "fetch_username", _boom)
    state = _set_state_cookie()
    r = _callback(state)
    assert "x_error=x_oauth_failed" in r.headers["location"]


def test_callback_oauth_refused(x_enabled):
    r = client.get("/api/v1/auth/x/callback?error=access_denied", follow_redirects=False)
    assert "x_error=oauth_refused" in r.headers["location"]


# ── pending + register (register-with-X) ───────────────────────────────────


def test_pending_returns_verified_handle(x_enabled):
    client.cookies.set(_REGISTER_COOKIE, x_oauth.sign_handle("xtest_pending"))
    r = client.get("/api/v1/auth/x/pending")
    assert r.status_code == 200
    assert r.json() == {"handle": "xtest_pending"}


def test_pending_404_without_cookie(x_enabled):
    assert client.get("/api/v1/auth/x/pending").status_code == 404


def test_register_creates_x_only_account(db, x_enabled):
    handle = _h("reg")
    username = _h("name")
    client.cookies.set(_REGISTER_COOKIE, x_oauth.sign_handle(handle))

    r = client.post("/api/v1/auth/x/register", json={"username": username})

    assert r.status_code == 201
    body = r.json()
    assert body["username"] == username
    assert body["email"] is None
    assert SESSION_COOKIE in r.cookies
    user = db.query(User).filter(User.username == username).first()
    assert user is not None
    assert user.x_handle == handle
    assert user.password_hash is None
    assert user.claimed_at is not None


def test_register_rejects_taken_username(db, x_enabled):
    existing = _user(db, handle=_h("other"), claimed=True)
    client.cookies.set(_REGISTER_COOKIE, x_oauth.sign_handle(_h("reg2")))

    r = client.post("/api/v1/auth/x/register", json={"username": existing.username})

    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "username_already_taken"


def test_register_without_cookie_is_expired(x_enabled):
    r = client.post("/api/v1/auth/x/register", json={"username": "xtest_whoever"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "x_register_expired"
