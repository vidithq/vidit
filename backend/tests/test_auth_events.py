"""Tests for the auth-events forensics primitive.

Two unrelated pieces covered:

1. HSTS — `Strict-Transport-Security` is stamped on every response.
2. `auth_events` audit log — each auth-path side-effect lands one row
   with the expected shape (event name, user_id when known, IP/UA).

The audit helper is deliberately best-effort (swallows its own exceptions),
asserted directly by patching ``db.add`` to raise.
"""

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

# ── Fixtures ──────────────────────────────────────────────────────────────


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
    """Drop outgoing email so register flows don't hit the wire."""

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


# ── HSTS ──────────────────────────────────────────────────────────────────


def test_hsts_header_on_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("strict-transport-security") == "max-age=15768000"


def test_hsts_header_on_404(client):
    response = client.get("/this-route-does-not-exist")
    assert response.status_code == 404
    # The header must travel even on error responses — TLS-stripping
    # attacks don't care whether the upstream is healthy.
    assert response.headers.get("strict-transport-security") == "max-age=15768000"


# ── Audit log: login ──────────────────────────────────────────────────────


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


def test_login_unknown_email_writes_failed_login_with_null_user_id(client, db):
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": f"nobody-{uuid.uuid4().hex}@example.com", "password": "wrong"},
    )
    assert response.status_code == 401

    rows = _events_for(db, event=EVENT_FAILED_LOGIN, since=cutoff)
    null_rows = [r for r in rows if r.user_id is None]
    # The address was unique to this test, so any new NULL row is ours.
    assert null_rows, "unknown email → at least one NULL-user_id failed_login row"


# ── Audit log: logout ─────────────────────────────────────────────────────


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


# ── Audit log: register + confirm ─────────────────────────────────────────


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
    # No users row exists yet, so this event MUST carry user_id NULL.
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

    # Teardown: remove the just-minted user so other tests don't see
    # stale rows from this fixture.
    db.query(User).filter(User.id == created_user_id).delete()
    db.commit()


# ── Audit log: password reset ─────────────────────────────────────────────


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
    # The matching property: NULL-user_id row exists for the no-op
    # branch, so the audit log is a "rate of requests" signal even when
    # the addresses don't resolve to users.
    assert any(r.user_id is None for r in rows)


# ── Audit log: resend confirmation ────────────────────────────────────────


def test_resend_confirmation_writes_event_on_matched_pending(
    client, fresh_invite, email_silencer, db
):
    """A resend against a live pending row writes ``register_resent``.

    Mirrors the ``/forgot-password`` discipline: ``user_id`` stays NULL
    on both branches because the ``users`` row doesn't exist yet for a
    pending registration — the audit row records "a resend was attempted
    from this IP" without leaking which addresses have a live pending.
    """
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

    # Teardown: drop the pending row so other tests don't see stale state.
    db.query(PendingRegistration).filter(PendingRegistration.email == email_addr).delete()
    db.commit()


def test_resend_confirmation_writes_event_on_unknown_email(client, email_silencer, db):
    """The no-op branch still writes an audit row.

    Closes the same "rate of requests" gap that ``/forgot-password``
    covers — without this, an attacker scripting resends against random
    addresses would leave no trace, defeating the rate-limit's
    forensics value.
    """
    cutoff = datetime.now(UTC) - timedelta(seconds=5)
    response = client.post(
        "/api/v1/auth/resend-confirmation",
        json={"email": f"ghost-{uuid.uuid4().hex}@example.com"},
    )
    assert response.status_code == 204

    rows = _events_for(db, event=EVENT_REGISTER_RESENT, since=cutoff)
    assert any(r.user_id is None for r in rows)


# ── Best-effort: a logging failure must not break login ───────────────────


def test_audit_failure_does_not_break_login_python_layer(client, existing_user, monkeypatch):
    """Python-layer failure (model __init__ raises).

    Covers the path where the failure happens before the row hits the
    DB — the ``with db.begin_nested()`` opens the savepoint, the
    ``AuthEvent(...)`` argument evaluation raises, and the savepoint's
    ``__exit__`` rolls back. The outer ``except Exception`` swallows it.
    """

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
    """Real DB-level failure (FK violation on flush inside the savepoint).

    The realistic failure mode in prod — a malformed row that only
    blows up on flush. Without ``db.begin_nested()``, the failed flush
    would poison the psycopg connection and the caller's next
    ``db.commit()`` would raise ``PendingRollbackError``. With the
    savepoint, only the audit row rolls back; login still commits and
    returns 200.

    Trigger: monkeypatch ``AuthEvent`` to return a row carrying a
    bogus ``user_id`` UUID that violates the FK to ``users.id``. The
    INSERT only fails when SQLAlchemy flushes the savepoint on
    ``__exit__`` — exactly the regression the savepoint exists to
    prevent.
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


# ── IP / UA extraction ────────────────────────────────────────────────────


class _FakeRequest:
    def __init__(self, *, headers: dict[str, str], client_host: str | None = None):
        self.headers = headers
        self.client = type("c", (), {"host": client_host})() if client_host else None


def test_extract_client_ip_takes_rightmost_forwarded_entry():
    """Right-most entry is the trusted proxy's observation.

    Left-most is attacker-controlled when the client can set the header
    themselves; taking it would let a malicious client spoof the audit
    log's IP column trivially. See `extract_client_ip` docstring.
    """
    req = _FakeRequest(
        headers={"x-forwarded-for": "1.2.3.4, 203.0.113.7"},
        client_host="10.0.0.1",
    )
    assert audit.extract_client_ip(req) == "203.0.113.7"


def test_extract_client_ip_resists_spoofing_via_prepended_xff():
    """A client prepending garbage to XFF must not poison the audit row.

    Realistic attack: client sends ``X-Forwarded-For: 1.2.3.4`` to make
    the audit log attribute their activity to a different IP. Railway
    appends the observed client IP, so the backend sees
    ``1.2.3.4, <real-client>``. Taking the right-most entry recovers
    the trusted value.
    """
    req = _FakeRequest(
        headers={"x-forwarded-for": "evil-prefix, 203.0.113.7"},
        client_host="10.0.0.1",
    )
    # Right-most parses cleanly; even though the left-most is garbage
    # we land on the trusted right-most value, not on the fallback.
    assert audit.extract_client_ip(req) == "203.0.113.7"


def test_extract_client_ip_falls_back_to_request_client():
    req = _FakeRequest(headers={}, client_host="198.51.100.5")
    assert audit.extract_client_ip(req) == "198.51.100.5"


def test_extract_client_ip_handles_no_source():
    req = _FakeRequest(headers={}, client_host=None)
    assert audit.extract_client_ip(req) is None


def test_rate_limit_key_takes_rightmost_xff_not_client_host():
    """slowapi keys MUST NOT come from ``request.client.host``.

    Under ``uvicorn --proxy-headers --forwarded-allow-ips=*`` (Railway
    prod config), uvicorn populates ``request.client.host`` with the
    LEFT-most entry of ``X-Forwarded-For`` (verified in the uvicorn
    source: ``always_trust=True`` → ``return x_forwarded_for_hosts[0]``).
    Railway *appends* to XFF rather than overwriting it, so the
    left-most entry is whatever the client typed — fully attacker-
    controlled. If slowapi keyed on that value (as the default
    ``get_remote_address`` does), an attacker could rotate
    ``X-Forwarded-For: <random>`` per request to mint a fresh bucket
    every time, OR send ``X-Forwarded-For: <victim_ip>`` to pin a
    chosen victim's bucket and lock them out.

    The fix: ``rate_limit_key`` routes through ``extract_client_ip``,
    which picks the RIGHT-most entry (the trusted proxy's observation).
    A spoofed-prefix XFF therefore resolves to the same key as a clean
    request from the same upstream — no fresh bucket, no victim pin.
    """
    # Simulate the prod shape: attacker prepends ``1.2.3.4``, Railway
    # appends the real client IP. ``request.client.host`` is what
    # uvicorn would have written (left-most = attacker), but we never
    # read it — the rightmost wins.
    spoofed = _FakeRequest(
        headers={"x-forwarded-for": "1.2.3.4, 203.0.113.7"},
        client_host="1.2.3.4",
    )
    clean = _FakeRequest(
        headers={"x-forwarded-for": "203.0.113.7"},
        client_host="203.0.113.7",
    )
    # Both requests land in the SAME bucket — the spoof can't mint a
    # fresh one and can't pin a third party's bucket.
    assert audit.rate_limit_key(spoofed) == audit.rate_limit_key(clean) == "203.0.113.7"


def test_rate_limit_key_returns_stable_sentinel_when_no_client():
    """Edge case: no XFF, no client (test harness / unusual proxy).
    The fallback must be a stable string so slowapi can key on it
    rather than crashing on ``None``."""
    no_source = _FakeRequest(headers={}, client_host=None)
    assert audit.rate_limit_key(no_source) == "rate-limit:no-client"


def test_extract_user_agent_caps_oversize_strings():
    req = _FakeRequest(headers={"user-agent": "A" * 4000})
    out = audit.extract_user_agent(req)
    assert out is not None
    assert len(out) == 1024


def test_extract_client_ip_rejects_garbage_values():
    """Hostile / malformed X-Forwarded-For lands as NULL.

    Postgres INET strict-rejects anything that isn't a parseable
    IPv4 / IPv6, so an unvalidated value would poison the savepoint on
    every audit insert. ``ipaddress.ip_address`` is the gate.
    """
    for hostile in [
        "not-an-ip",
        "127.0.0.1; DROP TABLE auth_events",
        "999.999.999.999",
        "<script>",
        "",
    ]:
        req = _FakeRequest(headers={"x-forwarded-for": hostile})
        assert audit.extract_client_ip(req) is None, f"should reject {hostile!r}"


def test_extract_client_ip_falls_back_when_forwarded_is_garbage():
    """A garbage Forwarded header should not stop us from logging the proxy IP."""
    req = _FakeRequest(
        headers={"x-forwarded-for": "not-an-ip"},
        client_host="198.51.100.5",
    )
    assert audit.extract_client_ip(req) == "198.51.100.5"


def test_extract_client_ip_honours_trusted_proxy_hops(monkeypatch):
    """With TRUSTED_PROXY_HOPS=2, pick the second-from-the-right entry.

    Two trusted proxies in front of the backend (e.g. Cloudflare →
    Railway → backend) means the chain reads
    ``client, cloudflare_observation``. Cloudflare is the immediate
    trusted proxy and wrote the right-most entry, but Cloudflare's
    own IP is not the client — the *client* IP is what Cloudflare
    saw when it appended, i.e. the second-from-the-right.
    """
    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "trusted_proxy_hops", 2)
    req = _FakeRequest(
        headers={"x-forwarded-for": "10.0.0.1, 104.16.0.1"},
        client_host="172.16.0.1",
    )
    assert audit.extract_client_ip(req) == "10.0.0.1"


def test_extract_client_ip_clamps_when_chain_is_shorter_than_hops(monkeypatch):
    """A misconfigured hop count must not drop the value entirely.

    Better forensics than nothing: if TRUSTED_PROXY_HOPS=3 but the
    XFF only carries two entries, peel as far as we can (left-most)
    rather than indexing out of range.
    """
    from app.config import settings as _settings

    monkeypatch.setattr(_settings, "trusted_proxy_hops", 3)
    req = _FakeRequest(
        headers={"x-forwarded-for": "10.0.0.1, 203.0.113.7"},
        client_host="172.16.0.1",
    )
    assert audit.extract_client_ip(req) == "10.0.0.1"


# ── HSTS on short-circuited responses ────────────────────────────────────


def test_hsts_header_on_csrf_rejection(client, existing_user):
    """A CSRFMiddleware short-circuit response must still carry HSTS.

    Auth-required mutating endpoints reject requests missing the
    `X-CSRF-Token` header before the route handler runs. HSTS is the
    outermost middleware so the rejection response is still stamped.
    """
    # /api/v1/events is mutation-guarded by CSRF and not in the
    # CSRF exempt list. A POST with no token short-circuits in CSRF.
    response = client.post("/api/v1/events", json={})
    assert response.status_code in (401, 403), "CSRF or auth should reject"
    assert response.headers.get("strict-transport-security") == "max-age=15768000"


# ── password_reset_completed ─────────────────────────────────────────────


def test_password_reset_completed_writes_event(client, existing_user, db, monkeypatch):
    """Exercises the reset-password path end-to-end and asserts the row lands."""
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
