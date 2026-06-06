import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.invite_code import InviteCode
from app.models.user import User

client = TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def fresh_invite(db):
    code = f"test-invite-{uuid.uuid4().hex}"
    invite = InviteCode(code=code)
    db.add(invite)
    db.commit()
    yield invite
    db.delete(invite)
    db.commit()


def test_check_invite_returns_404_for_unknown_code():
    response = client.get(f"/api/v1/auth/invites/does-not-exist-{uuid.uuid4().hex}/check")
    assert response.status_code == 404


def test_check_invite_returns_200_for_valid_unused_code(fresh_invite):
    response = client.get(f"/api/v1/auth/invites/{fresh_invite.code}/check")
    assert response.status_code == 200
    assert response.json() == {"valid": True}


def test_check_invite_does_not_consume_the_code(fresh_invite, db):
    client.get(f"/api/v1/auth/invites/{fresh_invite.code}/check")
    db.refresh(fresh_invite)
    assert fresh_invite.used_by is None
    assert fresh_invite.used_at is None


def test_check_invite_returns_404_for_exhausted_code(fresh_invite, db):
    user = User(
        username=f"u{uuid.uuid4().hex[:12]}",
        email=f"{uuid.uuid4().hex}@example.test",
        password_hash="x",
    )
    db.add(user)
    db.flush()
    # Exhaustion is governed by use_count >= max_uses, not by used_by.
    # used_by/used_at remain audit-only on the row.
    fresh_invite.used_by = user.id
    fresh_invite.used_at = datetime.now(UTC)
    fresh_invite.use_count = fresh_invite.max_uses
    db.commit()

    try:
        response = client.get(f"/api/v1/auth/invites/{fresh_invite.code}/check")
        assert response.status_code == 404
    finally:
        # Detach the FK before fresh_invite teardown deletes the invite row
        fresh_invite.used_by = None
        db.commit()
        db.delete(user)
        db.commit()


def test_check_invite_returns_404_for_revoked_code(fresh_invite, db):
    fresh_invite.revoked_at = datetime.now(UTC)
    db.commit()
    response = client.get(f"/api/v1/auth/invites/{fresh_invite.code}/check")
    assert response.status_code == 404


def test_check_invite_returns_200_for_multi_use_code_with_remaining_uses(db):
    code = f"test-multi-{uuid.uuid4().hex}"
    invite = InviteCode(code=code, max_uses=3, use_count=1)
    db.add(invite)
    db.commit()
    try:
        response = client.get(f"/api/v1/auth/invites/{code}/check")
        assert response.status_code == 200
    finally:
        db.delete(invite)
        db.commit()


def test_check_invite_returns_404_for_expired_code(db):
    code = f"test-expired-{uuid.uuid4().hex}"
    invite = InviteCode(code=code, expires_at=datetime.now(UTC) - timedelta(days=1))
    db.add(invite)
    db.commit()
    try:
        response = client.get(f"/api/v1/auth/invites/{code}/check")
        assert response.status_code == 404
    finally:
        db.delete(invite)
        db.commit()
