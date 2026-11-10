"""End-to-end tests for /auth/change-password.

Authenticated rotation: the user re-proves the current password, so a stolen
session alone cannot lock the owner out.
"""

from __future__ import annotations

import pytest

from app.models.audit_log import ACTION_PASSWORD_CHANGED, AuditLog
from app.routers import auth as auth_router
from app.services import email
from tests.conftest import DEFAULT_PASSWORD, login_as


def test_change_password_happy_path(client, make_user):
    user = make_user()
    new_password = "brandnewpassword2"

    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": new_password},
        headers=login_as(client, user),
    )
    assert response.status_code == 204

    # Clear the jar so the ``login_as`` cookie cannot mask a /login that depends on session state.
    client.cookies.clear()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": new_password},
    )
    assert ok.status_code == 200

    client.cookies.clear()
    rejected = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": DEFAULT_PASSWORD},
    )
    assert rejected.status_code == 401


def test_change_password_does_not_rotate_on_wrong_current(client, make_user):
    user = make_user()
    client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong-password", "new_password": "newpassword2"},
        headers=login_as(client, user),
    )
    client.cookies.clear()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": DEFAULT_PASSWORD},
    )
    assert ok.status_code == 200


def test_change_password_rejects_short_new_password(client, make_user):
    user = make_user()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "short"},
        headers=login_as(client, user),
    )
    assert response.status_code == 422


def test_change_password_refuses_a_new_password_over_72_bytes(client, make_user):
    user = make_user()
    # 40 characters, 80 bytes.
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "é" * 40},
        headers=login_as(client, user),
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "new_password"]

    client.cookies.clear()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": DEFAULT_PASSWORD},
    )
    assert ok.status_code == 200


def test_change_password_explains_the_byte_limit_for_an_over_long_ascii_password(client, make_user):
    user = make_user()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a" * 73},
        headers=login_as(client, user),
    )
    assert response.status_code == 422
    (error,) = response.json()["detail"]
    assert error["type"] == "password_too_long"
    assert "72 bytes" in error["msg"]


@pytest.mark.parametrize("current", ["é" * 40, "a" * 201], ids=["80-bytes", "201-chars"])
def test_change_password_treats_an_over_long_current_password_as_incorrect(
    client, make_user, current
):
    user = make_user()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": "brandnewpassword2"},
        headers=login_as(client, user),
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Current password is incorrect"


def test_change_password_requires_authentication(client):
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "anything", "new_password": "newpassword2"},
    )
    assert response.status_code == 401


def test_change_password_writes_audit_event(client, make_user, db, sent_emails):
    # ``email_recorder`` keeps the heads-up task from hitting the live provider.
    user = make_user()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "brandnewpassword2"},
        headers=login_as(client, user),
    )
    assert response.status_code == 204

    events = (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == user.id, AuditLog.action == ACTION_PASSWORD_CHANGED)
        .all()
    )
    assert len(events) == 1


def test_change_password_sends_heads_up_email(client, make_user, sent_emails):
    """A successful rotation sends one email: the only out-of-band signal an owner gets
    if credentials are stuffed against the form."""
    user = make_user()
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "brandnewpassword2"},
        headers=login_as(client, user),
    )
    assert response.status_code == 204
    assert len(sent_emails) == 1
    sent = sent_emails[0]
    assert sent.to == user.email
    assert "password" in sent.subject.lower()
    # The body must surface the recovery path so a victim has a single
    # actionable link to reach.
    assert "forgot-password" in sent.text


def test_change_password_does_not_email_on_wrong_current(client, make_user, sent_emails):
    """No rotation, no notification — symmetry with the audit event."""
    user = make_user()
    response = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "definitelynotthecorrectone",
            "new_password": "newpassword2",
        },
        headers=login_as(client, user),
    )
    assert response.status_code == 400
    assert sent_emails == []


def test_change_password_swallows_email_send_failure(client, make_user, monkeypatch, db):
    """An ``EmailSendError`` from the background task is swallowed: 204, and the new password works."""

    def _boom(_email_obj):
        raise email.EmailSendError("simulated provider outage")

    monkeypatch.setattr(auth_router.email, "send", _boom)

    user = make_user()
    new_password = "brandnewpassword2"
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": new_password},
        headers=login_as(client, user),
    )
    assert response.status_code == 204

    client.cookies.clear()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": new_password},
    )
    assert ok.status_code == 200

    events = (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == user.id, AuditLog.action == ACTION_PASSWORD_CHANGED)
        .all()
    )
    assert len(events) == 1
