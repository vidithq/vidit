"""Lock-in tests for the session-lifecycle invalidation mechanism.

The session JWT embeds the user's ``token_version`` as a ``tv`` claim;
``get_current_user`` 401s on mismatch. Bumping the column at the four
mutation points (logout, password change, password reset, soft-delete)
invalidates every outstanding session for the user.

These tests guard against regressions where a future refactor of the
mint or check sides drops the ``tv`` semantics — without them, the
"clearing the session cookie doesn't invalidate the token" gap returns
silently and a leaked JWT stays live to its ``exp``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models.auth_token import PURPOSE_PASSWORD_RESET, AuthToken
from app.models.user import User
from app.routers import auth as auth_router
from app.services import auth as auth_service
from app.services import auth_tokens, email
from app.services.auth_cookies import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE
from tests.conftest import TEST_CSRF_TOKEN, login_as


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def user_factory(db):
    """Create users with a known password; cascade-clean afterwards."""

    created: list[User] = []

    def _make(
        *, password: str = "originalpassword1", deleted: bool = False, active: bool = True
    ) -> tuple[User, str]:
        user = User(
            username=f"u{uuid.uuid4().hex[:12]}",
            email=f"{uuid.uuid4().hex}@example.com",
            password_hash=auth_service.hash_password(password),
            is_active=active,
            deleted_at=datetime.now(UTC) if deleted else None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        created.append(user)
        return user, password

    yield _make

    for user in created:
        db.query(User).filter(User.id == user.id).delete()
    db.commit()


@pytest.fixture
def email_recorder(monkeypatch):
    sent: list[email.Email] = []
    monkeypatch.setattr(auth_router.email, "send", lambda e: sent.append(e))
    return sent


def _sibling_session_cookie_for(user: User) -> str:
    """Mint a JWT for ``user`` at the current token_version. Simulates a
    second device that logged in before any invalidation event."""
    return auth_service.create_access_token(user)


def _hit_me_with(client: TestClient, session_token: str) -> int:
    """Call /auth/me with a hand-crafted session cookie. Returns status."""
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, session_token)
    return client.get("/api/v1/auth/me").status_code


# ── Logout ────────────────────────────────────────────────────────────────


def test_logout_bumps_token_version_and_invalidates_sibling_sessions(client, user_factory, db):
    user, _ = user_factory()
    sibling_token = _sibling_session_cookie_for(user)
    assert _hit_me_with(client, sibling_token) == 200

    # Issue logout from the device's session. Reuse login_as for the
    # CSRF + cookie shape (logout requires a valid CSRF pair).
    headers = login_as(client, user)
    response = client.post("/api/v1/auth/logout", headers=headers)
    assert response.status_code == 204

    # The sibling session, minted at tv=0, now mismatches the bumped row.
    db.refresh(user)
    assert user.token_version == 1
    assert _hit_me_with(client, sibling_token) == 401


def test_logout_without_cookie_does_not_touch_any_user(client, user_factory, db):
    user, _ = user_factory()
    starting_tv = user.token_version

    client.cookies.clear()
    # CSRF still required (the middleware fires regardless of session); set
    # only the CSRF pair to bypass it.
    client.cookies.set(CSRF_COOKIE, TEST_CSRF_TOKEN)
    response = client.post("/api/v1/auth/logout", headers={CSRF_HEADER: TEST_CSRF_TOKEN})
    assert response.status_code == 204

    db.refresh(user)
    assert user.token_version == starting_tv


def test_logout_with_tampered_cookie_does_not_bump(client, user_factory, db):
    user, _ = user_factory()
    starting_tv = user.token_version

    # Hand-roll a JWT signed with a different secret — would decode-fail.
    forged = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(minutes=10), "tv": 0},
        "not-the-real-secret",
        algorithm=settings.jwt_algorithm,
    )
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, forged)
    client.cookies.set(CSRF_COOKIE, TEST_CSRF_TOKEN)
    response = client.post("/api/v1/auth/logout", headers={CSRF_HEADER: TEST_CSRF_TOKEN})
    assert response.status_code == 204

    db.refresh(user)
    assert user.token_version == starting_tv, (
        "A tampered cookie must not let an attacker bump an arbitrary "
        "user's token_version — that would be a free DoS-by-logout."
    )


# ── Change password ──────────────────────────────────────────────────────


def test_change_password_invalidates_other_sessions_but_keeps_current_cookie_alive(
    client, user_factory, email_recorder, db
):
    user, current = user_factory()
    sibling_token = _sibling_session_cookie_for(user)
    assert _hit_me_with(client, sibling_token) == 200

    headers = login_as(client, user)
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": "brandnewpassword2"},
        headers=headers,
    )
    assert response.status_code == 204

    db.refresh(user)
    assert user.token_version == 1

    # Sibling session minted at tv=0 → 401.
    assert _hit_me_with(client, sibling_token) == 401

    # The cookie the response set carries the bumped tv. Read it from
    # the response Set-Cookie directly — TestClient's cookie jar update
    # path is racy across versions, so the response is the authoritative
    # source.
    response_session = response.cookies.get(SESSION_COOKIE)
    assert response_session is not None
    decoded = jwt.decode(response_session, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert decoded["tv"] == 1
    assert _hit_me_with(client, response_session) == 200


# ── Password reset ───────────────────────────────────────────────────────


def _mint_reset_token(db, user: User) -> str:
    raw = auth_tokens.mint(
        db,
        user_id=user.id,
        purpose=PURPOSE_PASSWORD_RESET,
        ttl_minutes=settings.password_reset_token_minutes,
    )
    db.commit()
    return raw


def test_reset_password_bumps_token_version_for_all_sessions(client, user_factory, db):
    user, _ = user_factory()
    sibling_token = _sibling_session_cookie_for(user)
    raw_token = _mint_reset_token(db, user)

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "freshpassword3"},
    )
    assert response.status_code == 204

    db.refresh(user)
    assert user.token_version == 1
    assert _hit_me_with(client, sibling_token) == 401


def test_reset_password_rejects_soft_deleted_user_with_live_token(client, user_factory, db):
    """Mint-side parity: ``/login`` and the forgot-password mint both reject
    soft-deleted accounts. ``/reset-password`` must do the same so an
    attacker holding a token captured *before* the account was disabled
    can't rotate the password back into a usable credential."""
    user, _ = user_factory()
    raw_token = _mint_reset_token(db, user)

    # Soft-delete after the token was minted but before it's consumed.
    user.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "wontwork12345"},
    )
    assert response.status_code == 400
    # And the token row is rolled back to unconsumed so the attacker
    # doesn't even get to burn it as a side effect.
    db.expire_all()
    row = (
        db.query(AuthToken)
        .filter(AuthToken.user_id == user.id, AuthToken.purpose == PURPOSE_PASSWORD_RESET)
        .order_by(AuthToken.created_at.desc())
        .first()
    )
    assert row is not None
    assert row.consumed_at is None


def test_reset_password_rejects_deactivated_user_with_live_token(client, user_factory, db):
    """Same mint-parity, deactivation path — covers the case soft-delete's
    FK cascade doesn't catch (``is_active=False`` leaves rows intact)."""
    user, _ = user_factory(active=False)
    raw_token = _mint_reset_token(db, user)

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "wontwork12345"},
    )
    assert response.status_code == 400


# ── Soft-delete ──────────────────────────────────────────────────────────


def test_soft_delete_user_bumps_token_version(user_factory, db):
    """Admin soft-deleting a user must invalidate the user's sessions
    immediately, not at the next token rotation. The deleted_at check in
    get_current_user already 401s, but the explicit bump means any
    cached / pre-check code path also fails — and an admin un-soft-
    deleting later doesn't accidentally revive the user's old sessions.
    """
    from app.services import admin as admin_service

    actor, _ = user_factory()
    target, _ = user_factory()
    starting_tv = target.token_version

    admin_service.soft_delete_user(db, actor_id=actor.id, user_id=target.id)

    db.refresh(target)
    assert target.token_version == starting_tv + 1
    assert target.deleted_at is not None


# ── Missing tv claim (pre-migration JWT shape) ───────────────────────────


def test_jwt_without_tv_claim_returns_401(client, user_factory):
    """Pre-migration tokens (no ``tv`` claim) must 401 — the migration's
    one-time forced logout is the intended deploy effect."""
    user, _ = user_factory()
    legacy = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(minutes=10)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    assert _hit_me_with(client, legacy) == 401
