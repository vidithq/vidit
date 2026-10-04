"""HSTS header, `auth_events` audit rows, and the rate-limit key's right-most-XFF extraction."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.auth_event import (
    EVENT_FAILED_LOGIN,
    EVENT_LOGIN,
    EVENT_LOGOUT,
    EVENT_PASSWORD_RESET_COMPLETED,
    EVENT_PASSWORD_RESET_REQUESTED,
    EVENT_REGISTER_CONFIRMED,
    EVENT_REGISTER_PENDING,
    EVENT_REGISTER_RESENT,
    AuthEvent,
)
from app.models.invite_code import InviteCode
from app.models.pending_registration import PendingRegistration
from app.models.user import User
from app.routers import auth as auth_router
from app.services import audit
from app.services import auth as auth_service


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
def email_silencer(monkeypatch):

    def _drop(_email_obj):
        return None

    monkeypatch.setattr(auth_router.email, "send", _drop)


@pytest.fixture
def fresh_invite(db):
    code = f"audit-invite-{uuid.uuid4().hex}"
    invite = InviteCode(code=code)
    db.add(invite)
    db.commit()
    yield invite
    db.delete(invite)
    db.commit()


@pytest.fixture
def existing_user(db):
    user = User(
        username=f"u{uuid.uuid4().hex[:12]}",
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash=auth_service.hash_password("originalpassword1"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    yield user
    db.query(User).filter(User.id == user.id).delete()
    db.commit()


def _events_for(db, *, event: str, since: datetime) -> list[AuthEvent]:
    return (
        db.query(AuthEvent)
        .filter(AuthEvent.event == event, AuthEvent.created_at >= since)
        .order_by(AuthEvent.created_at)
        .all()
    )


def test_hsts_header_on_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("strict-transport-security") == "max-age=15768000"


def test_hsts_header_on_404(client):
    response = client.get("/this-route-does-not-exist")
    assert response.status_code == 404
    # TLS-stripping attacks don't care whether the upstream is healthy.
    assert response.headers.get("strict-transport-security") == "max-age=15768000"


def test_login_success_writes_login_event(client, existing_user, db):
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": existing_user.email, "password": "originalpassword1"},
    )
    assert response.status_code == 200

    rows = _events_for(db, event=EVENT_LOGIN, since=cutoff)
    matching = [r for r in rows if r.user_id == existing_user.id]
    assert len(matching) == 1
    row = matching[0]
    assert row.event == EVENT_LOGIN
    assert row.user_id == existing_user.id


def test_login_wrong_password_writes_failed_login_with_user_id(client, existing_user, db):
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": existing_user.email, "password": "wrong"},
    )
    assert response.status_code == 401

    rows = _events_for(db, event=EVENT_FAILED_LOGIN, since=cutoff)
    matching = [r for r in rows if r.user_id == existing_user.id]
    assert len(matching) == 1, "matched user → row carries user_id for forensics"


def test_login_deactivated_account_is_rejected(client, existing_user, db):
    existing_user.is_active = False
    db.add(existing_user)
    db.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={"email": existing_user.email, "password": "originalpassword1"},
    )

    assert response.status_code == 401


def test_login_unknown_email_writes_failed_login_with_null_user_id(client, db):
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": f"nobody-{uuid.uuid4().hex}@example.com", "password": "wrong"},
    )
    assert response.status_code == 401

    rows = _events_for(db, event=EVENT_FAILED_LOGIN, since=cutoff)
    null_rows = [r for r in rows if r.user_id is None]
    assert null_rows, "unknown email → at least one NULL-user_id failed_login row"


def test_logout_writes_logout_event_with_user_id(client, existing_user, db):
    login = client.post(
        "/api/v1/auth/login",
        json={"email": existing_user.email, "password": "originalpassword1"},
    )
    assert login.status_code == 200

    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/logout",
        headers={"X-CSRF-Token": login.cookies.get("vidit_csrf", "")},
    )
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_LOGOUT, since=cutoff)
    assert any(r.user_id == existing_user.id for r in rows)


def test_logout_without_session_writes_row_with_null_user_id(client, db):
    fresh = TestClient(app)
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = fresh.post("/api/v1/auth/logout")
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_LOGOUT, since=cutoff)
    assert any(r.user_id is None for r in rows)


def test_register_pending_writes_event_with_null_user_id(client, fresh_invite, email_silencer, db):
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    email_addr = f"reg-{uuid.uuid4().hex}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email_addr,
            "username": f"u{uuid.uuid4().hex[:12]}",
            "password": "newpassword12",
            "invite_code": fresh_invite.code,
        },
    )
    assert response.status_code == 202

    rows = _events_for(db, event=EVENT_REGISTER_PENDING, since=cutoff)
    # No users row exists yet: user_id is NULL.
    assert any(r.user_id is None for r in rows)


def test_confirm_registration_writes_event_with_user_id(
    client, fresh_invite, email_silencer, db, monkeypatch
):
    captured: dict[str, str] = {}

    def _capture(*, to: str, raw_token: str) -> None:
        captured["token"] = raw_token

    monkeypatch.setattr(auth_router, "_send_registration_confirmation_best_effort", _capture)

    email_addr = f"reg-{uuid.uuid4().hex}@example.com"
    username = f"u{uuid.uuid4().hex[:12]}"
    register_resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": email_addr,
            "username": username,
            "password": "newpassword12",
            "invite_code": fresh_invite.code,
        },
    )
    assert register_resp.status_code == 202
    assert "token" in captured

    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    confirm_resp = client.post(
        "/api/v1/auth/confirm-registration",
        json={"token": captured["token"]},
    )
    assert confirm_resp.status_code == 200
    body = confirm_resp.json()
    created_user_id = uuid.UUID(body["id"])

    rows = _events_for(db, event=EVENT_REGISTER_CONFIRMED, since=cutoff)
    assert any(r.user_id == created_user_id for r in rows)

    db.query(User).filter(User.id == created_user_id).delete()
    db.commit()


def test_forgot_password_writes_event_on_known_email(client, existing_user, email_silencer, db):
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": existing_user.email},
    )
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_PASSWORD_RESET_REQUESTED, since=cutoff)
    assert any(r.user_id == existing_user.id for r in rows)


def test_forgot_password_writes_event_on_unknown_email(client, email_silencer, db):
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/forgot-password",
        json={"email": f"ghost-{uuid.uuid4().hex}@example.com"},
    )
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_PASSWORD_RESET_REQUESTED, since=cutoff)
    # No-op branch still writes a NULL-user_id row (a rate-of-requests signal).
    assert any(r.user_id is None for r in rows)


def test_resend_confirmation_writes_event_on_matched_pending(
    client, fresh_invite, email_silencer, db
):
    """A resend against a live pending row writes ``register_resent`` with NULL user_id."""
    email_addr = f"reg-{uuid.uuid4().hex}@example.com"
    register_resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": email_addr,
            "username": f"u{uuid.uuid4().hex[:12]}",
            "password": "newpassword12",
            "invite_code": fresh_invite.code,
        },
    )
    assert register_resp.status_code == 202

    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/resend-confirmation",
        json={"email": email_addr},
    )
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_REGISTER_RESENT, since=cutoff)
    assert len(rows) >= 1
    assert all(r.user_id is None for r in rows)

    db.query(PendingRegistration).filter(PendingRegistration.email == email_addr).delete()
    db.commit()


def test_resend_confirmation_writes_event_on_unknown_email(client, email_silencer, db):
    """The no-op branch still writes an audit row, so scripted resends leave a trace."""
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/resend-confirmation",
        json={"email": f"ghost-{uuid.uuid4().hex}@example.com"},
    )
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_REGISTER_RESENT, since=cutoff)
    assert any(r.user_id is None for r in rows)


def test_audit_failure_does_not_break_login_python_layer(client, existing_user, monkeypatch):
    """Failure before the row hits the DB (model ``__init__`` raises) is swallowed."""

    class _ExplodingAuthEvent:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("simulated python-side failure")

    monkeypatch.setattr("app.services.audit.AuthEvent", _ExplodingAuthEvent)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": existing_user.email, "password": "originalpassword1"},
    )
    assert response.status_code == 200


def test_audit_failure_does_not_break_login_db_layer(client, existing_user, monkeypatch):
    """A flush-time FK violation rolls back only the audit savepoint; login still returns 200.

    Without ``db.begin_nested()`` the failed flush would poison the connection
    and the caller's next commit would raise ``PendingRollbackError``.
    """
    from app.models.auth_event import AuthEvent as RealAuthEvent

    bogus_user_id = uuid.uuid4()

    def _bogus_factory(**kwargs):
        kwargs["user_id"] = bogus_user_id  # not in users table → FK fails on flush
        return RealAuthEvent(**kwargs)

    monkeypatch.setattr("app.services.audit.AuthEvent", _bogus_factory)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": existing_user.email, "password": "originalpassword1"},
    )
    assert response.status_code == 200


# Mirrors the right-most-XFF rule in `rate_limit_key`; the bucket key must stay unspoofable.


class _FakeRequest:
    def __init__(self, *, headers: dict[str, str], client_host: str | None = None):
        self.headers = headers
        self.client = type("c", (), {"host": client_host})() if client_host else None


def test_rate_limit_key_takes_rightmost_xff_not_client_host():
    """slowapi keys must not come from ``request.client.host``.

    uvicorn sets it to the left-most X-Forwarded-For entry, which the client
    controls (Railway appends). Keying on it would let an attacker mint fresh
    buckets or pin a victim's bucket. ``rate_limit_key`` uses the right-most entry.
    """
    # Attacker prepends 1.2.3.4, the proxy appends the real client IP.
    spoofed = _FakeRequest(
        headers={"x-forwarded-for": "1.2.3.4, 203.0.113.7"},
        client_host="1.2.3.4",
    )
    clean = _FakeRequest(
        headers={"x-forwarded-for": "203.0.113.7"},
        client_host="203.0.113.7",
    )
    # Same bucket: the spoof can neither mint a fresh one nor pin a third party's.
    assert audit.rate_limit_key(spoofed) == audit.rate_limit_key(clean) == "203.0.113.7"


def test_rate_limit_key_resists_garbage_prefix():
    """A garbage left-most entry never poisons the key."""
    req = _FakeRequest(
        headers={"x-forwarded-for": "evil-prefix, 203.0.113.7"},
        client_host="10.0.0.1",
    )
    assert audit.rate_limit_key(req) == "203.0.113.7"


def test_rate_limit_key_falls_back_to_request_client():
    req = _FakeRequest(headers={}, client_host="198.51.100.5")
    assert audit.rate_limit_key(req) == "198.51.100.5"


def test_rate_limit_key_returns_stable_sentinel_when_no_client():
    """No XFF and no client falls back to a stable string, not ``None``."""
    no_source = _FakeRequest(headers={}, client_host=None)
    assert audit.rate_limit_key(no_source) == "rate-limit:no-client"


def test_rate_limit_key_rejects_garbage_values():
    """Malformed X-Forwarded-For never becomes a bucket key (``ipaddress.ip_address`` gates it)."""
    for hostile in [
        "not-an-ip",
        "127.0.0.1; DROP TABLE auth_events",
        "999.999.999.999",
        "<script>",
        "",
    ]:
        req = _FakeRequest(headers={"x-forwarded-for": hostile})
        assert audit.rate_limit_key(req) == "rate-limit:no-client", f"should reject {hostile!r}"


def test_rate_limit_key_falls_back_when_forwarded_is_garbage():
    """A garbage Forwarded header still keys on the peer."""
    req = _FakeRequest(
        headers={"x-forwarded-for": "not-an-ip"},
        client_host="198.51.100.5",
    )
    assert audit.rate_limit_key(req) == "198.51.100.5"


def test_rate_limit_key_honours_trusted_proxy_hops(monkeypatch):
    """With TRUSTED_PROXY_HOPS=2, pick the second-from-the-right entry (the client IP seen by the first proxy)."""
    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "trusted_proxy_hops", 2)
    req = _FakeRequest(
        headers={"x-forwarded-for": "10.0.0.1, 104.16.0.1"},
        client_host="172.16.0.1",
    )
    assert audit.rate_limit_key(req) == "10.0.0.1"


def test_rate_limit_key_clamps_when_chain_is_shorter_than_hops(monkeypatch):
    """A hop count larger than the XFF chain peels to the left-most entry instead of indexing out of range."""
    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "trusted_proxy_hops", 3)
    req = _FakeRequest(
        headers={"x-forwarded-for": "10.0.0.1, 203.0.113.7"},
        client_host="172.16.0.1",
    )
    assert audit.rate_limit_key(req) == "10.0.0.1"


def test_hsts_header_on_csrf_rejection(client, existing_user):
    """A CSRFMiddleware short-circuit response still carries HSTS (HSTS is the outermost middleware)."""
    # Mutation-guarded by CSRF: a POST with no token short-circuits.
    response = client.post("/api/v1/events", json={})
    assert response.status_code in (401, 403), "CSRF or auth should reject"
    assert response.headers.get("strict-transport-security") == "max-age=15768000"


def test_password_reset_completed_writes_event(client, existing_user, db, monkeypatch):
    """Reset-password end to end writes the audit row."""
    from app.models.auth_token import PURPOSE_PASSWORD_RESET
    from app.services import auth_tokens

    raw_token = auth_tokens.mint(
        db, user_id=existing_user.id, purpose=PURPOSE_PASSWORD_RESET, ttl_minutes=60
    )
    db.commit()

    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": raw_token, "new_password": "freshpassword99"},
    )
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_PASSWORD_RESET_COMPLETED, since=cutoff)
    assert any(r.user_id == existing_user.id for r in rows)
