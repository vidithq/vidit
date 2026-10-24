"""Tests for the maintenance service + admin /maintenance/* endpoints.

Exercises the maintenance primitives through the admin endpoints: auth, rate limits, audit row.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.audit_log import AuditLog
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event, EventDetection
from app.models.password_reset_token import (
    PasswordResetToken,
)
from app.models.source import Source, SourceLink
from app.models.user import User
from app.services import maintenance as maintenance_service
from app.services.auth import hash_password
from app.services.email import EmailSendError
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
    db.query(AuditLog).filter(AuditLog.actor_id == user_id).delete()
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


# ── reap_password_reset_tokens ───────────────────────────────────────────────────


def test_reap_password_reset_tokens_drops_expired_and_old_consumed(db, regular_user):
    now = datetime.now(UTC)

    expired = PasswordResetToken(
        user_id=regular_user.id,
        token_hash=f"exp-{uuid.uuid4().hex}",
        expires_at=now - timedelta(hours=1),
    )
    live = PasswordResetToken(
        user_id=regular_user.id,
        token_hash=f"live-{uuid.uuid4().hex}",
        expires_at=now + timedelta(hours=1),
    )
    old_consumed = PasswordResetToken(
        user_id=regular_user.id,
        token_hash=f"old-{uuid.uuid4().hex}",
        expires_at=now - timedelta(days=60),
        consumed_at=now - timedelta(days=45),
    )
    fresh_consumed = PasswordResetToken(
        user_id=regular_user.id,
        token_hash=f"fresh-{uuid.uuid4().hex}",
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

    result = maintenance_service.reap_password_reset_tokens(db)
    assert result["expired"] >= 1
    assert result["old_consumed"] >= 1

    db.expire_all()
    assert db.query(PasswordResetToken).filter(PasswordResetToken.id == expired_id).first() is None
    assert db.query(PasswordResetToken).filter(PasswordResetToken.id == old_id).first() is None
    assert db.query(PasswordResetToken).filter(PasswordResetToken.id == live_id).first() is not None
    assert (
        db.query(PasswordResetToken).filter(PasswordResetToken.id == fresh_id).first() is not None
    )


def test_reap_password_reset_tokens_endpoint_for_admin(admin_user, db):
    response = client.post(
        "/api/v1/admin/maintenance/reap-password-reset-tokens",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert "expired" in body
    assert "old_consumed" in body

    event = (
        db.query(AuditLog)
        .filter(
            AuditLog.actor_id == admin_user.id,
            AuditLog.action == "maintenance_reap_password_reset_tokens",
        )
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    assert event is not None


def test_reap_password_reset_tokens_endpoint_403_for_regular_user(regular_user):
    response = client.post(
        "/api/v1/admin/maintenance/reap-password-reset-tokens",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


# ── send_completion_digests ────────────────────────────────────────────


@pytest.fixture
def detection_owner(db):
    """An analyst with an address, torn down with everything that FKs to them."""
    user = User(
        username=f"d{uuid.uuid4().hex[:8]}",
        email=f"detections-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("p"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _detection(db, owner, **kwargs) -> Event:
    """One live machine detection owned by ``owner``."""
    row = Event(
        owner_id=owner.id,
        title=f"Detection {uuid.uuid4().hex[:8]}",
        coords=from_shape(Point(34.5, 48.5), srid=4326),
        sources=[
            Source(
                level="direct", kind="unknown", links=[SourceLink(url="https://x.com/a/status/1")]
            )
        ],
        detection=EventDetection(from_url="https://x.com/a/status/1"),
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
        **kwargs,
    )
    db.add(row)
    db.commit()
    return row


def _counts(db, owner) -> int | None:
    """The digest's count for ``owner``, or None when they aren't selected."""
    for user, _address, count in maintenance_service.detections_awaiting_completion(db):
        if user.id == owner.id:
            return count
    return None


def test_digest_selects_analysts_by_live_detection_count(db, detection_owner):
    _detection(db, detection_owner)
    _detection(db, detection_owner)
    assert _counts(db, detection_owner) == 2


def test_digest_counts_only_unpublished_real_work(db, detection_owner):
    """The count covers detections awaiting a decision; published and soft-deleted rows are out."""
    _detection(db, detection_owner)
    _detection(db, detection_owner, deleted_at=datetime.now(UTC))
    published = _detection(db, detection_owner)
    published.status = STATUS_GEOLOCATED
    published.geolocated_at = datetime.now(UTC)
    db.commit()

    assert _counts(db, detection_owner) == 1


def test_digest_does_not_count_a_withheld_detection(db, detection_owner):
    """A taken-down detection is frozen for its owner, so the digest does not count it."""
    _detection(db, detection_owner)
    _detection(db, detection_owner, hidden_at=datetime.now(UTC))
    assert _counts(db, detection_owner) == 1


def test_digest_skips_an_analyst_with_no_detections(db, detection_owner):
    assert _counts(db, detection_owner) is None


def test_digest_skips_a_deactivated_analyst(db, detection_owner):
    _detection(db, detection_owner)
    detection_owner.is_active = False
    db.commit()
    assert _counts(db, detection_owner) is None


def test_digest_sends_one_email_per_analyst(db, detection_owner, monkeypatch):
    """One message per analyst, with the count and a link to their own queue."""
    _detection(db, detection_owner)
    _detection(db, detection_owner)
    sent: list = []
    monkeypatch.setattr(maintenance_service.email_service, "send", sent.append)

    result = maintenance_service.send_completion_digests(db)

    assert result["analysts_notified"] >= 1
    assert result["digest_send_failures"] == 0
    mine = [email for email in sent if email.to == detection_owner.email]
    assert len(mine) == 1
    assert "2" in mine[0].subject
    assert f"/profile/{detection_owner.username}/detections" in mine[0].text


def test_digest_survives_a_provider_failure(db, detection_owner, monkeypatch):
    """A rejected address is counted, not raised (the digest is re-sendable), and
    ``detections_pending`` counts delivered messages only."""
    _detection(db, detection_owner)

    def _boom(email):
        raise EmailSendError("provider down")

    monkeypatch.setattr(maintenance_service.email_service, "send", _boom)

    result = maintenance_service.send_completion_digests(db)
    assert result["analysts_notified"] == 0
    assert result["digest_send_failures"] >= 1
    assert result["detections_pending"] == 0


def test_digest_caps_the_addresses_one_click_writes_to(db, detection_owner):
    """One click is bounded (a provider round-trip per analyst, no resume marker); the biggest backlogs are kept."""
    _detection(db, detection_owner)
    selected = maintenance_service.detections_awaiting_completion(db, limit=1)
    assert len(selected) == 1


def test_send_completion_digests_endpoint_for_admin(admin_user, db, monkeypatch):
    monkeypatch.setattr(maintenance_service.email_service, "send", lambda email: None)
    response = client.post(
        "/api/v1/admin/maintenance/send-completion-digests",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert "analysts_notified" in body
    assert "detections_pending" in body

    event = (
        db.query(AuditLog)
        .filter(
            AuditLog.actor_id == admin_user.id,
            AuditLog.action == "maintenance_send_completion_digests",
        )
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    assert event is not None


def test_send_completion_digests_endpoint_403_for_regular_user(regular_user):
    response = client.post(
        "/api/v1/admin/maintenance/send-completion-digests",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_reap_proof_orphans_endpoint_is_gone(admin_user):
    """The orphan reaper endpoint no longer exists."""
    response = client.post(
        "/api/v1/admin/maintenance/reap-proof-orphans",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
