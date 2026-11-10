"""End-to-end tests for /auth/forgot-password and /auth/reset-password.

The tests go through the endpoints, where wrong-token and replay safety must
hold. The email service is patched
with a recorder to assert the right *Email* went to the right recipient.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.database import SessionLocal
from app.models.password_reset_token import (
    PasswordResetToken,
)
from app.routers import auth as auth_router
from app.services import email, password_reset_tokens

# ── Helpers ───────────────────────────────────────────────────────────────


def _extract_token(text: str) -> str:
    marker = "?token="
    idx = text.index(marker) + len(marker)
    end = idx
    while end < len(text) and not text[end].isspace():
        end += 1
    return text[idx:end]


# ── Forgot password ───────────────────────────────────────────────────────


def test_forgot_password_unknown_email_returns_204_and_sends_nothing(client, sent_emails):
    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": f"nobody-{uuid.uuid4().hex}@example.com"},
    )
    assert response.status_code == 204
    assert sent_emails == [], "must not send to unknown addresses"


def test_forgot_password_known_email_mints_token_and_sends(client, make_user, sent_emails, db):
    user = make_user()
    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": user.email},
    )
    assert response.status_code == 204
    assert len(sent_emails) == 1
    sent = sent_emails[0]
    assert sent.to == user.email
    assert "Reset" in sent.subject
    assert "/reset-password?token=" in sent.text

    rows = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.consumed_at.is_(None),
        )
        .all()
    )
    assert len(rows) == 1


def test_forgot_password_revokes_previously_outstanding_tokens(client, make_user, sent_emails, db):
    user = make_user()
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})

    live = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.consumed_at.is_(None),
        )
        .all()
    )
    consumed = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.consumed_at.isnot(None),
        )
        .all()
    )
    assert len(live) == 1, "second request keeps exactly one live token"
    assert len(consumed) == 1, "first token is force-consumed (revoked)"


def test_forgot_password_dispatches_work_to_background_task(client, make_user, monkeypatch):
    """The mint + send runs off the request thread; inline work would leak user existence via
    response time. TestClient runs BackgroundTasks before returning, so the test records
    ``BackgroundTasks.add_task`` and asserts the worker was scheduled."""
    from fastapi import BackgroundTasks

    user = make_user()
    scheduled: list = []
    original = BackgroundTasks.add_task

    def recording_add_task(self, func, *args, **kwargs):
        scheduled.append(func)
        return original(self, func, *args, **kwargs)

    monkeypatch.setattr(BackgroundTasks, "add_task", recording_add_task)

    response = client.post("/api/v1/auth/forgot-password", json={"email": user.email})

    assert response.status_code == 204
    assert scheduled == [auth_router._process_forgot_password]


def test_forgot_password_swallows_email_send_failure(client, monkeypatch, make_user, db):
    user = make_user()

    def _boom(_email: email.Email) -> None:
        raise email.EmailSendError("simulated outage")

    monkeypatch.setattr(auth_router.email, "send", _boom)

    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": user.email},
    )
    # A 5xx here would leak account existence.
    assert response.status_code == 204


# ── Reset password ────────────────────────────────────────────────────────


def test_reset_password_happy_path(client, make_user, sent_emails, db):
    user = make_user()
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    token = _extract_token(sent_emails[0].text)

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


def test_reset_password_refuses_a_password_over_72_bytes(client, make_user, sent_emails):
    user = make_user()
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    token = _extract_token(sent_emails[0].text)

    # 40 characters, 80 bytes.
    refused = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "é" * 40},
    )
    assert refused.status_code == 422
    assert refused.json()["detail"][0]["loc"] == ["body", "new_password"]

    # The refusal happens before the token is read, so the link still works.
    accepted = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "brandnewpassword2"},
    )
    assert accepted.status_code == 204


def test_reset_password_rejects_replay(client, make_user, sent_emails):
    user = make_user()
    client.post("/api/v1/auth/forgot-password", json={"email": user.email})
    token = _extract_token(sent_emails[0].text)

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


def test_reset_password_rejects_expired_token(client, make_user, db):
    user = make_user()
    raw = password_reset_tokens.mint(
        db,
        user_id=user.id,
        ttl_minutes=15,
    )
    db.commit()
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).update(
        {"expires_at": datetime.now(UTC) - timedelta(minutes=1)}
    )
    db.commit()

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw, "new_password": "newpassword2"},
    )
    assert response.status_code == 400


# ── Race-safety regression ────────────────────────────────────────────────


def test_consume_atomic_under_parallel_use(make_user):
    """Two concurrent consume() calls on one token must not both win.

    A SELECT-then-mutate under READ COMMITTED lets both see `consumed_at IS NULL`;
    the atomic UPDATE...WHERE consumed_at IS NULL gives one winner.
    """
    import threading

    user = make_user()

    # Own session, so the fixture session holds no row lock.
    minting_session = SessionLocal()
    try:
        raw = password_reset_tokens.mint(
            minting_session,
            user_id=user.id,
            ttl_minutes=15,
        )
        minting_session.commit()
    finally:
        minting_session.close()

    results: list[PasswordResetToken | None] = []
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def worker():
        session = SessionLocal()
        try:
            barrier.wait(timeout=2)
            row = password_reset_tokens.consume(session, raw)
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
