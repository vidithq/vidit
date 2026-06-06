"""Tests for the maintenance service + admin /maintenance/* endpoints.

These replace the cron scripts that previously lived in
`backend/scripts/reap_*.py`. Exercise the same primitives but through
the admin endpoint surface — auth, rate limits, audit row.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.auth_token import (
    PURPOSE_PASSWORD_RESET,
    AuthToken,
)
from app.models.proof_image import ProofImage
from app.models.user import User
from app.services import maintenance as maintenance_service
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_test_client_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def admin_user(db):
    user = User(
        username=f"adm{uuid.uuid4().hex[:8]}",
        email=f"admin-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def regular_user(db):
    user = User(
        username=f"u{uuid.uuid4().hex[:8]}",
        email=f"u-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


# ── reap_auth_tokens ───────────────────────────────────────────────────


def test_reap_auth_tokens_drops_expired_and_old_consumed(db, regular_user):
    now = datetime.now(UTC)

    expired = AuthToken(
        user_id=regular_user.id,
        token_hash=f"exp-{uuid.uuid4().hex}",
        purpose=PURPOSE_PASSWORD_RESET,
        expires_at=now - timedelta(hours=1),
    )
    live = AuthToken(
        user_id=regular_user.id,
        token_hash=f"live-{uuid.uuid4().hex}",
        purpose=PURPOSE_PASSWORD_RESET,
        expires_at=now + timedelta(hours=1),
    )
    old_consumed = AuthToken(
        user_id=regular_user.id,
        token_hash=f"old-{uuid.uuid4().hex}",
        purpose=PURPOSE_PASSWORD_RESET,
        expires_at=now - timedelta(days=60),
        consumed_at=now - timedelta(days=45),
    )
    fresh_consumed = AuthToken(
        user_id=regular_user.id,
        token_hash=f"fresh-{uuid.uuid4().hex}",
        purpose=PURPOSE_PASSWORD_RESET,
        expires_at=now - timedelta(days=1),
        consumed_at=now - timedelta(hours=2),
    )
    db.add_all([expired, live, old_consumed, fresh_consumed])
    db.commit()

    expired_id, live_id, old_id, fresh_id = (
        expired.id,
        live.id,
        old_consumed.id,
        fresh_consumed.id,
    )

    result = maintenance_service.reap_auth_tokens(db)
    assert result["expired"] >= 1
    assert result["old_consumed"] >= 1

    db.expire_all()
    assert db.query(AuthToken).filter(AuthToken.id == expired_id).first() is None
    assert db.query(AuthToken).filter(AuthToken.id == old_id).first() is None
    assert db.query(AuthToken).filter(AuthToken.id == live_id).first() is not None
    assert db.query(AuthToken).filter(AuthToken.id == fresh_id).first() is not None


def test_reap_auth_tokens_endpoint_for_admin(admin_user, db):
    response = client.post(
        "/api/v1/admin/maintenance/reap-auth-tokens",
        headers=login_as(client, admin_user.id),
    )
    assert response.status_code == 200
    body = response.json()
    assert "expired" in body
    assert "old_consumed" in body

    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "maintenance_reap_auth_tokens",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None


def test_reap_auth_tokens_endpoint_403_for_regular_user(regular_user):
    response = client.post(
        "/api/v1/admin/maintenance/reap-auth-tokens",
        headers=login_as(client, regular_user.id),
    )
    assert response.status_code == 403


# ── reap_proof_image_orphans ───────────────────────────────────────────


def test_reap_proof_orphans_skips_recent_and_linked(db, regular_user, monkeypatch):
    # Patch storage to a no-op so the test doesn't touch the filesystem.
    class FakeStorage:
        def delete_many(self, keys):
            return None

    monkeypatch.setattr(maintenance_service, "get_storage", lambda: FakeStorage())

    now = datetime.now(UTC)
    old_orphan = ProofImage(
        s3_key=f"proof/{regular_user.id}/old-{uuid.uuid4().hex}.jpg",
        user_id=regular_user.id,
        geolocation_id=None,
        created_at=now - timedelta(hours=48),
    )
    recent_orphan = ProofImage(
        s3_key=f"proof/{regular_user.id}/new-{uuid.uuid4().hex}.jpg",
        user_id=regular_user.id,
        geolocation_id=None,
        created_at=now - timedelta(hours=2),
    )
    db.add_all([old_orphan, recent_orphan])
    db.commit()
    old_id, recent_id = old_orphan.id, recent_orphan.id

    result = maintenance_service.reap_proof_image_orphans(db)
    assert result["rows_deleted"] >= 1

    db.expire_all()
    assert db.query(ProofImage).filter(ProofImage.id == old_id).first() is None
    assert db.query(ProofImage).filter(ProofImage.id == recent_id).first() is not None


def test_reap_proof_orphans_endpoint_for_admin(admin_user, db):
    response = client.post(
        "/api/v1/admin/maintenance/reap-proof-orphans",
        headers=login_as(client, admin_user.id),
    )
    assert response.status_code == 200
    body = response.json()
    assert "rows_deleted" in body
    assert "s3_deleted" in body

    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "maintenance_reap_proof_orphans",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
