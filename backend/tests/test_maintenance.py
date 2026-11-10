"""Tests for the maintenance service + admin /maintenance/* endpoints.

Exercises the maintenance primitives through the admin endpoints: auth, rate limits, audit row.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.audit_log import AuditLog
from app.models.event import STATUS_GEOLOCATED
from app.models.password_reset_token import (
    PasswordResetToken,
)
from app.services import maintenance as maintenance_service
from app.services.email import EmailSendError
from tests._fixtures import client, make_detection
from tests.conftest import login_as


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
def detection_owner(make_user):
    return make_user("d")


def _counts(db, owner) -> int | None:
    """The digest's count for ``owner``, or None when they aren't selected."""
    for user, _address, count in maintenance_service.detections_awaiting_completion(db):
        if user.id == owner.id:
            return count
    return None


def test_digest_selects_analysts_by_live_detection_count(db, detection_owner):
    make_detection(db, detection_owner)
    make_detection(db, detection_owner)
    assert _counts(db, detection_owner) == 2


def test_digest_counts_only_unpublished_real_work(db, detection_owner):
    """The count covers detections awaiting a decision; published and soft-deleted rows are out."""
    make_detection(db, detection_owner)
    make_detection(db, detection_owner, deleted=True)
    published = make_detection(db, detection_owner)
    published.status = STATUS_GEOLOCATED
    published.version_no = 1
    published.geolocated_at = datetime.now(UTC)
    db.commit()

    assert _counts(db, detection_owner) == 1


def test_digest_does_not_count_a_withheld_detection(db, detection_owner):
    """A taken-down detection is frozen for its owner, so the digest does not count it."""
    make_detection(db, detection_owner)
    make_detection(db, detection_owner, hidden=True)
    assert _counts(db, detection_owner) == 1


def test_digest_skips_an_analyst_with_no_detections(db, detection_owner):
    assert _counts(db, detection_owner) is None


def test_digest_skips_a_deactivated_analyst(db, detection_owner):
    make_detection(db, detection_owner)
    detection_owner.is_active = False
    db.commit()
    assert _counts(db, detection_owner) is None


def test_digest_sends_one_email_per_analyst(db, detection_owner, monkeypatch):
    """One message per analyst, with the count and a link to their own queue."""
    make_detection(db, detection_owner)
    make_detection(db, detection_owner)
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
    make_detection(db, detection_owner)

    def _boom(email):
        raise EmailSendError("provider down")

    monkeypatch.setattr(maintenance_service.email_service, "send", _boom)

    result = maintenance_service.send_completion_digests(db)
    assert result["analysts_notified"] == 0
    assert result["digest_send_failures"] >= 1
    assert result["detections_pending"] == 0


def test_digest_caps_the_addresses_one_click_writes_to(db, make_user):
    """One click is bounded (a provider round-trip per analyst, no resume marker); the biggest
    backlogs are kept."""
    small, big = make_user("d"), make_user("d")
    make_detection(db, small)
    make_detection(db, big)
    make_detection(db, big)
    [(user, _address, count)] = maintenance_service.detections_awaiting_completion(db, limit=1)
    assert (user.id, count) == (big.id, 2)


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
