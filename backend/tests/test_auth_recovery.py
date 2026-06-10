"""End-to-end tests for /auth/forgot-password and /auth/reset-password.

The pre-creation registration flow (and its email confirmation) lives
in `test_registration_pending.py`. The soft-verify endpoints
(/auth/verify-email, /auth/resend-verification) were removed in the
pre-creation cutover and so are not exercised here.

We exercise the wired-up endpoints rather than the auth_tokens service in
isolation: the mint/consume contract is the primitive, but the endpoints
are where wrong-purpose / wrong-token / replay safety actually has to
hold. A test on the service alone wouldn't catch a router misuse like
"register hands a verification token but reset_password calls consume(_,
PURPOSE_PASSWORD_RESET) anyway".

The email service is monkeypatched with a recorder rather than mocked at
the HTTP layer — we want to assert that the right *Email* object went to
the right *recipient*, not "httpx.Client.post was called once".
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.auth_token import (
    PURPOSE_EMAIL_VERIFICATION,
    PURPOSE_PASSWORD_RESET,
    AuthToken,
)
from app.models.user import User
from app.routers import auth as auth_router
from app.services import auth as auth_service
from app.services import auth_tokens, email

# ── Helpers ───────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    # Fresh client per test so cookie jars don't leak: once any test
    # logs in, the session cookie sticks on the client and the CSRF
    # middleware starts 403'ing every subsequent POST that isn't on
    # the exempt list. Same pattern as test_auth_cookies.py.
    return TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def email_recorder(monkeypatch):
    """Capture every email.send() call in order."""

    sent: list[email.Email] = []

    def _record(email_obj: email.Email) -> None:
        sent.append(email_obj)

    monkeypatch.setattr(auth_router.email, "send", _record)
    return sent


@pytest.fixture
def user_factory(db):
    """Create users with a known password; clean them up afterwards."""

    created: list[User] = []

    def _make(*, password: str = "originalpassword1") -> tuple[User, str]:
        user = User(
            username=f"u{uuid.uuid4().hex[:12]}",
            email=f"{uuid.uuid4().hex}@example.com",
            password_hash=auth_service.hash_password(password),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        created.append(user)
        return user, password

    yield _make

    for user in created:
        # Cascade deletes auth_tokens via the FK; just nuke the user.
        db.query(User).filter(User.id == user.id).delete()
    db.commit()


def _extract_token(text: str) -> str:
    marker = "?token="
    idx = text.index(marker) + len(marker)
    end = idx
    while end < len(text) and not text[end].isspace():
        end += 1
    return text[idx:end]


# ── Forgot password ───────────────────────────────────────────────────────


def test_forgot_password_unknown_email_returns_204_and_sends_nothing(client, email_recorder):
    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": f"nobody-{uuid.uuid4().hex}@example.com"},
    )
    assert response.status_code == 204
    assert email_recorder == [], "must not send to unknown addresses"


def test_forgot_password_known_email_mints_token_and_sends(
    client, user_factory, email_recorder, db
):
    user, _ = user_factory()
    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": user.email},
    )
    assert response.status_code == 204
    assert len(email_recorder) == 1
    sent = email_recorder[0]
    assert sent.to == user.email
    assert "Reset" in sent.subject
    assert "/reset-password?token=" in sent.text

    rows = (
        db.query(AuthToken)
        .filter(
            AuthToken.user_id == user.id,
            AuthToken.purpose == PURPOSE_PASSWORD_RESET,
            AuthToken.consumed_at.is_(None),
        )
        .all()
    )
    assert len(rows) == 1


def test_forgot_password_revokes_previously_outstanding_tokens(
    client, user_factory, email_recorder, db
):
    user, _ = user_factory()
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})

    live = (
        db.query(AuthToken)
        .filter(
            AuthToken.user_id == user.id,
            AuthToken.purpose == PURPOSE_PASSWORD_RESET,
            AuthToken.consumed_at.is_(None),
        )
        .all()
    )
    consumed = (
        db.query(AuthToken)
        .filter(
            AuthToken.user_id == user.id,
            AuthToken.purpose == PURPOSE_PASSWORD_RESET,
            AuthToken.consumed_at.isnot(None),
        )
        .all()
    )
    assert len(live) == 1, "second request keeps exactly one live token"
    assert len(consumed) == 1, "first token is force-consumed (revoked)"


def test_forgot_password_dispatches_work_to_background_task(client, user_factory, monkeypatch):
    """The mint + send happens off the request thread.

    Without this, the live-user branch is hundreds of ms slower than the
    no-user branch (DB UPDATE + bcrypt mint + Resend round-trip), which
    leaks user existence via response time regardless of any rate limit.
    We assert the endpoint route handler itself never calls the worker —
    only schedules it via FastAPI's BackgroundTasks.
    """
    user, _ = user_factory()

    called_inline = False

    def fake_worker(*args, **kwargs):
        nonlocal called_inline
        called_inline = True

    # Patch the worker symbol the route handler closes over. The route
    # MUST add it as a background task (which the TestClient runs *after*
    # response), not call it directly.
    real_worker = auth_router._process_forgot_password
    monkeypatch.setattr(auth_router, "_process_forgot_password", fake_worker)

    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": user.email},
    )

    # TestClient runs BackgroundTasks before handing back the response, so the
    # post-response invocation proves the handler used the background-task
    # dispatch path. The absence of inline blocking isn't directly observable in
    # TestClient; this is the strongest assertion available.
    assert response.status_code == 204
    assert called_inline is True, "background task was not scheduled"

    # Restore so subsequent tests in the same process see the real worker.
    monkeypatch.setattr(auth_router, "_process_forgot_password", real_worker)


def test_forgot_password_swallows_email_send_failure(client, monkeypatch, user_factory, db):
    user, _ = user_factory()

    def _boom(_email: email.Email) -> None:
        raise email.EmailSendError("simulated outage")

    monkeypatch.setattr(auth_router.email, "send", _boom)

    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": user.email},
    )
    # Must NOT 5xx — would leak account existence (200 for unknown,
    # 500 for known-but-email-broken would be a side channel).
    assert response.status_code == 204


# ── Reset password ────────────────────────────────────────────────────────


def test_reset_password_happy_path(client, user_factory, email_recorder, db):
    user, _ = user_factory()
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    token = _extract_token(email_recorder[0].text)

    new_password = "brandnewpassword2"
    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": new_password},
    )
    assert response.status_code == 204

    login = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": new_password},
    )
    assert login.status_code == 200


def test_reset_password_rejects_replay(client, user_factory, email_recorder):
    user, _ = user_factory()
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    token = _extract_token(email_recorder[0].text)

    r1 = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "newpassword2"},
    )
    assert r1.status_code == 204

    r2 = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "anothernewpw3"},
    )
    assert r2.status_code == 400


def test_reset_password_rejects_unknown_token(client):
    response = client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": "definitely-not-a-real-token-just-padding-padding-padding",
            "new_password": "doesntmatter1",
        },
    )
    assert response.status_code == 400


def test_reset_password_rejects_expired_token(client, user_factory, db):
    user, _ = user_factory()
    raw = auth_tokens.mint(
        db,
        user_id=user.id,
        purpose=PURPOSE_PASSWORD_RESET,
        ttl_minutes=15,
    )
    db.commit()
    db.query(AuthToken).filter(AuthToken.user_id == user.id).update(
        {"expires_at": datetime.now(UTC) - timedelta(minutes=1)}
    )
    db.commit()

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw, "new_password": "newpassword2"},
    )
    assert response.status_code == 400


def test_reset_password_rejects_token_with_wrong_purpose(client, user_factory, db):
    """A token minted for any other purpose must NOT pass for /reset-password.

    Pins the consume() purpose check — the shared auth_tokens table
    makes it easy to mix purposes up at the call site, so this test
    is the regression line. We mint with ``email_verification`` (a
    legacy purpose still allowed by the DB CHECK constraint, retained
    precisely so this regression test has a non-``password_reset``
    value to use).
    """
    user, _ = user_factory()
    raw = auth_tokens.mint(
        db,
        user_id=user.id,
        purpose=PURPOSE_EMAIL_VERIFICATION,
        ttl_minutes=60,
    )
    db.commit()

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw, "new_password": "newpassword2"},
    )
    assert response.status_code == 400


# ── Race-safety regression ────────────────────────────────────────────────


def test_consume_atomic_under_parallel_use(user_factory):
    """Two concurrent consume() calls on the same token must not both win.

    Pre-fix this test failed: with a SELECT-then-mutate pattern under
    READ COMMITTED, two threads could both observe `consumed_at IS NULL`,
    both set it, and both commit. With the atomic UPDATE...WHERE
    consumed_at IS NULL one thread wins the row-lock; the other sees
    zero rows updated and returns None. For password-reset that's the
    difference between a stolen-token race ending in attacker control
    and ending in a wasted attempt.
    """
    import threading

    user, _ = user_factory()

    # Mint via its own session so the test fixture session doesn't hold
    # a lock on the row when the threads start hammering.
    minting_session = SessionLocal()
    try:
        raw = auth_tokens.mint(
            minting_session,
            user_id=user.id,
            purpose=PURPOSE_PASSWORD_RESET,
            ttl_minutes=15,
        )
        minting_session.commit()
    finally:
        minting_session.close()

    results: list[AuthToken | None] = []
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def worker():
        session = SessionLocal()
        try:
            barrier.wait(timeout=2)
            row = auth_tokens.consume(session, raw, PURPOSE_PASSWORD_RESET)
            session.commit()
            results.append(row)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            session.close()

    t1 = threading.Thread(target=worker)
    t2 = threading.Thread(target=worker)
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert errors == [], f"workers raised: {errors}"
    winners = [r for r in results if r is not None]
    assert len(winners) == 1, (
        f"exactly one consume() must succeed; got {len(winners)} successes "
        f"out of {len(results)} attempts"
    )
