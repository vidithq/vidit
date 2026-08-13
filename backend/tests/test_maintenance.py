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
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.auth_token import (
    PURPOSE_PASSWORD_RESET,
    AuthToken,
)
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
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
        headers=login_as(client, admin_user),
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
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


# ── enqueue_source_archival ────────────────────────────────────────────


def test_enqueue_source_archival_endpoint_for_admin(admin_user, db):
    response = client.post(
        "/api/v1/admin/maintenance/enqueue-source-archival",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert "events_scanned" in body
    assert "links_enqueued" in body

    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "maintenance_enqueue_source_archival",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None


def test_enqueue_source_archival_endpoint_403_for_regular_user(regular_user):
    response = client.post(
        "/api/v1/admin/maintenance/enqueue-source-archival",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


# ── send_completion_digests ────────────────────────────────────────────


@pytest.fixture
def draft_owner(db):
    """An analyst with an address, torn down with everything that FKs to them."""
    user = User(
        username=f"d{uuid.uuid4().hex[:8]}",
        email=f"drafts-{uuid.uuid4().hex}@example.com",
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


def _draft(db, owner, **kwargs) -> Event:
    """One live machine ``detected`` draft owned by ``owner``."""
    row = Event(
        owner_id=owner.id,
        title=f"Draft {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://x.com/a/status/1",
        detected_from_url="https://x.com/a/status/1",
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
        **kwargs,
    )
    db.add(row)
    db.commit()
    return row


def _counts(db, owner) -> int | None:
    """The digest's count for ``owner``, or None when they aren't selected."""
    for user, _address, count in maintenance_service.drafts_awaiting_completion(db):
        if user.id == owner.id:
            return count
    return None


def test_digest_selects_analysts_by_live_draft_count(db, draft_owner):
    _draft(db, draft_owner)
    _draft(db, draft_owner)
    assert _counts(db, draft_owner) == 2


def test_digest_counts_only_unpublished_real_work(db, draft_owner):
    """What the count is about: drafts still awaiting a decision. A published
    row, a soft-deleted one, and a seeded demo row are all out."""
    _draft(db, draft_owner)
    _draft(db, draft_owner, is_demo=True)
    _draft(db, draft_owner, deleted_at=datetime.now(UTC))
    published = _draft(db, draft_owner)
    published.status = STATUS_GEOLOCATED
    published.geolocated_at = datetime.now(UTC)
    db.commit()

    assert _counts(db, draft_owner) == 1


def test_digest_does_not_count_a_withheld_draft(db, draft_owner):
    """A takedown freezes the draft for its owner, so the digest must not nag
    them to complete one they are not allowed to publish."""
    _draft(db, draft_owner)
    _draft(db, draft_owner, hidden_at=datetime.now(UTC))
    assert _counts(db, draft_owner) == 1


def test_digest_skips_an_analyst_with_no_drafts(db, draft_owner):
    assert _counts(db, draft_owner) is None


def test_digest_skips_a_deactivated_analyst(db, draft_owner):
    _draft(db, draft_owner)
    draft_owner.is_active = False
    db.commit()
    assert _counts(db, draft_owner) is None


def test_digest_sends_one_email_per_analyst(db, draft_owner, monkeypatch):
    """One message, the count in it, and the link back to that analyst's own
    queue."""
    _draft(db, draft_owner)
    _draft(db, draft_owner)
    sent: list = []
    monkeypatch.setattr(maintenance_service.email_service, "send", sent.append)

    result = maintenance_service.send_completion_digests(db)

    assert result["analysts_notified"] >= 1
    assert result["digest_send_failures"] == 0
    mine = [email for email in sent if email.to == draft_owner.email]
    assert len(mine) == 1
    assert "2" in mine[0].subject
    assert f"/profile/{draft_owner.username}/detections" in mine[0].text


def test_digest_survives_a_provider_failure(db, draft_owner, monkeypatch):
    """A rejected address is counted, never raised: a digest is re-sendable on
    the next run, and the other analysts still get theirs. A failed send covers
    no drafts, so ``drafts_pending`` counts delivered messages only."""
    _draft(db, draft_owner)

    def _boom(email):
        raise EmailSendError("provider down")

    monkeypatch.setattr(maintenance_service.email_service, "send", _boom)

    result = maintenance_service.send_completion_digests(db)
    assert result["analysts_notified"] == 0
    assert result["digest_send_failures"] >= 1
    assert result["drafts_pending"] == 0


def test_digest_caps_the_addresses_one_click_writes_to(db, draft_owner):
    """The action is one provider round-trip per analyst with no resume marker,
    so a click is bounded; the biggest backlogs survive the cut."""
    _draft(db, draft_owner)
    selected = maintenance_service.drafts_awaiting_completion(db, limit=1)
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
    assert "drafts_pending" in body

    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "maintenance_send_completion_digests",
        )
        .order_by(AdminEvent.created_at.desc())
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
    """Proof images upload at publish now (no unattached staging row), so the
    orphan reaper and its endpoint were removed with the ``proof_images``
    table."""
    response = client.post(
        "/api/v1/admin/maintenance/reap-proof-orphans",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
