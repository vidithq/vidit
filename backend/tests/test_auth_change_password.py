"""End-to-end tests for /auth/change-password.

Authenticated password rotation. Sibling to /auth/reset-password but with
a different threat model: the user is *already* signed in and we need
them to re-prove knowledge of the current credential before the rotation
goes through, so a stolen session alone cannot lock the legitimate
owner out.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.auth_event import EVENT_PASSWORD_CHANGED, AuthEvent
from app.models.user import User
from app.routers import auth as auth_router
from app.services import auth as auth_service
from app.services import email
from tests.conftest import login_as


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
def email_recorder(monkeypatch):
    """Capture every email.send() call in order.

    Mirrors the recovery-test fixture: monkeypatches ``email.send`` on
    the *router* import site so the background task that fires after
    the response goes out lands in the recorder instead of attempting
    a real Resend round-trip.
    """

    sent: list[email.Email] = []

    def _record(email_obj: email.Email) -> None:
        sent.append(email_obj)

    monkeypatch.setattr(auth_router.email, "send", _record)
    return sent


@pytest.fixture
def user_factory(db):
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
        db.query(AuthEvent).filter(AuthEvent.user_id == user.id).delete()
        db.query(User).filter(User.id == user.id).delete()
    db.commit()


def test_change_password_happy_path(client, user_factory):
    user, current = user_factory()
    new_password = "brandnewpassword2"

    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": new_password},
        headers=login_as(client, user),
    )
    assert response.status_code == 204

    # The new password works; the old one doesn't. Clearing the jar
    # between each /login is defensive — the session cookie from
    # ``login_as`` would otherwise carry into the second request and
    # mask a regression where ``/login`` started caring about prior
    # session state (it doesn't today, but the assertion target is
    # password-acceptance, not session-handoff).
    client.cookies.clear()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": new_password},
    )
    assert ok.status_code == 200

    client.cookies.clear()
    rejected = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": current},
    )
    assert rejected.status_code == 401


def test_change_password_rejects_wrong_current_password(client, user_factory):
    user, _ = user_factory()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "definitelynotthecorrectone", "new_password": "newpassword2"},
        headers=login_as(client, user),
    )
    assert response.status_code == 400


def test_change_password_does_not_rotate_on_wrong_current(client, user_factory):
    user, current = user_factory()
    client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong-password", "new_password": "newpassword2"},
        headers=login_as(client, user),
    )
    # Original credential still works after a rejected rotation attempt.
    client.cookies.clear()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": current},
    )
    assert ok.status_code == 200


def test_change_password_rejects_short_new_password(client, user_factory):
    user, current = user_factory()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": "short"},
        headers=login_as(client, user),
    )
    assert response.status_code == 422


def test_change_password_requires_authentication(client):
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "anything", "new_password": "newpassword2"},
    )
    assert response.status_code == 401


def test_change_password_writes_audit_event(client, user_factory, db, email_recorder):
    # ``email_recorder`` is here to absorb the heads-up background task
    # the endpoint now dispatches — without it, ``email.send`` would
    # follow the live ``EMAIL_PROVIDER`` setting and could either pad
    # the test wall time or attempt a real Resend round-trip. The
    # assertion target is the audit row, not the email itself; the
    # dedicated email test lives below.
    user, current = user_factory()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": "brandnewpassword2"},
        headers=login_as(client, user),
    )
    assert response.status_code == 204

    events = (
        db.query(AuthEvent)
        .filter(AuthEvent.user_id == user.id, AuthEvent.event == EVENT_PASSWORD_CHANGED)
        .all()
    )
    assert len(events) == 1


def test_change_password_sends_heads_up_email(client, user_factory, email_recorder):
    """A successful rotation must trigger one informational email.

    The endpoint enforces re-asserting the current password, so this
    notification is the only out-of-band signal a legitimate owner gets
    if their credentials are stuffed against the form. Without this
    test, a future refactor (e.g. dropping the BackgroundTask) would
    silently delete the heads-up surface.
    """
    user, current = user_factory()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": "brandnewpassword2"},
        headers=login_as(client, user),
    )
    assert response.status_code == 204
    assert len(email_recorder) == 1
    sent = email_recorder[0]
    assert sent.to == user.email
    assert "password" in sent.subject.lower()
    # The body must surface the recovery path so a victim has a single
    # actionable link to reach.
    assert "forgot-password" in sent.text


def test_change_password_does_not_email_on_wrong_current(client, user_factory, email_recorder):
    """No rotation, no notification — symmetry with the audit event."""
    user, _ = user_factory()
    response = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "definitelynotthecorrectone",
            "new_password": "newpassword2",
        },
        headers=login_as(client, user),
    )
    assert response.status_code == 400
    assert email_recorder == []


def test_change_password_swallows_email_send_failure(client, user_factory, monkeypatch, db):
    """A Resend outage must not unwind a successful rotation.

    The password is rotated and the audit event committed before the
    background task fires. If ``email.send`` raises ``EmailSendError``,
    the dispatcher swallows it and logs — the user sees a 204 and the
    new password works on the next login.
    """

    def _boom(_email_obj):
        raise email.EmailSendError("simulated provider outage")

    monkeypatch.setattr(auth_router.email, "send", _boom)

    user, current = user_factory()
    new_password = "brandnewpassword2"
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": new_password},
        headers=login_as(client, user),
    )
    assert response.status_code == 204

    # The rotation actually landed — the new password authenticates.
    client.cookies.clear()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": new_password},
    )
    assert ok.status_code == 200

    # And the audit row was written.
    events = (
        db.query(AuthEvent)
        .filter(AuthEvent.user_id == user.id, AuthEvent.event == EVENT_PASSWORD_CHANGED)
        .all()
    )
    assert len(events) == 1
