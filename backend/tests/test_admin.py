import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.geolocation import STATUS_REQUESTED, Geolocation
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_test_client_cookies():
    """Wipe TestClient cookies between tests.

    Every test sets its own session via ``login_as``; without this fixture
    a leftover cookie from a prior test authenticates the next one as a
    now-deleted user and produces a spurious 401.
    """
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
    # Reap this actor's admin events + invite codes so the row deletes without
    # FK violations. invite_codes FKs are ON DELETE SET NULL (migration
    # f1a3b5c7d9e0); dropped explicitly anyway to keep test data clean.
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete()
    db.query(InviteCode).filter(InviteCode.created_by == user_id).delete()
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def regular_user(db):
    user = User(
        username=f"usr{uuid.uuid4().hex[:8]}",
        email=f"user-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    # Tests may have hard-deleted the row; bulk delete-by-id rather than
    # db.delete(instance), which would refresh a vanished row → ObjectDeletedError.
    # Drop the user's events first so the users.id FK doesn't block the user
    # delete (soft-delete tests leave the row in place; media/claims cascade).
    # Since the merge, requests and geolocations are one table, so a single
    # author_id / requested_by_id sweep covers both.
    db.expire_all()
    db.query(Geolocation).filter(Geolocation.author_id == user_id).delete(synchronize_session=False)
    db.query(Geolocation).filter(Geolocation.requested_by_id == user_id).delete(
        synchronize_session=False
    )
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def test_admin_me_returns_200_for_admin(admin_user):
    response = client.get("/api/v1/admin/me", headers=login_as(client, admin_user))
    assert response.status_code == 200
    assert response.json() == {"is_admin": True}


def test_admin_me_returns_403_for_regular_user(regular_user):
    response = client.get("/api/v1/admin/me", headers=login_as(client, regular_user))
    assert response.status_code == 403


def test_admin_me_returns_401_for_anonymous():
    response = client.get("/api/v1/admin/me")
    assert response.status_code == 401


def test_create_invite_code_persists_and_returns_active(admin_user, db):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"expires_in_days": 7},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    body = response.json()
    # Codes are single-use by policy — every code names exactly one analyst.
    assert body["max_uses"] == 1
    assert body["use_count"] == 0
    assert body["status"] == "active"
    assert body["expires_at"] is not None
    assert body["revoked_at"] is None
    assert body["used_by_username"] is None

    invite = db.query(InviteCode).filter(InviteCode.id == uuid.UUID(body["id"])).first()
    assert invite is not None
    assert invite.code == body["code"]


def test_create_invite_code_writes_admin_event(admin_user, db):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    invite_id = uuid.UUID(response.json()["id"])

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "invite_created")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {"invite_code_id": str(invite_id)}


def test_create_invite_code_ignores_max_uses_in_body(admin_user, db):
    # The schema doesn't accept ``max_uses``; it's silently ignored and the
    # service still hardcodes 1.
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"max_uses": 50},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    assert response.json()["max_uses"] == 1


def test_create_invite_code_403_for_regular_user(regular_user):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_list_invite_codes_includes_status(admin_user):
    create_response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    code = create_response.json()["code"]

    list_response = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user))
    assert list_response.status_code == 200
    rows = list_response.json()
    matching = [r for r in rows if r["code"] == code]
    assert len(matching) == 1
    assert matching[0]["status"] == "active"


def test_revoke_invite_code_marks_revoked(admin_user):
    create_response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    invite_id = create_response.json()["id"]

    revoke_response = client.delete(
        f"/api/v1/admin/invite-codes/{invite_id}",
        headers=login_as(client, admin_user),
    )
    assert revoke_response.status_code == 200
    body = revoke_response.json()
    assert body["status"] == "revoked"
    assert body["revoked_at"] is not None

    # The revoked code is rejected by the public /invites/{code}/check
    code = create_response.json()["code"]
    check_response = client.get(f"/api/v1/auth/invites/{code}/check")
    assert check_response.status_code == 404


def test_revoke_invite_code_returns_404_for_unknown_id(admin_user):
    response = client.delete(
        f"/api/v1/admin/invite-codes/{uuid.uuid4()}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404


def test_login_auto_promotes_when_email_matches_admin_emails(monkeypatch, db):
    # Pydantic's EmailStr is strict about TLDs — .test is rejected, so use
    # @example.com (which the rest of the suite also uses for /login flows).
    email = f"prom-{uuid.uuid4().hex}@example.com"
    user = User(
        username=f"prom{uuid.uuid4().hex[:8]}",
        email=email,
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id

    monkeypatch.setattr(settings, "admin_emails", email)
    try:
        response = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "password123"},
        )
        assert response.status_code == 200

        db.expire_all()
        promoted = db.query(User).filter(User.id == user_id).first()
        assert promoted is not None
        assert promoted.is_admin is True
    finally:
        db.query(User).filter(User.id == user_id).delete()
        db.commit()


def test_search_users_returns_matches_for_admin(admin_user, regular_user):
    response = client.get(
        f"/api/v1/admin/users?q={regular_user.username[:6]}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    rows = response.json()
    assert any(r["id"] == str(regular_user.id) for r in rows)
    # Schema includes is_trusted + trust_reason for the toggle UI
    target = next(r for r in rows if r["id"] == str(regular_user.id))
    assert target["is_trusted"] is False
    assert target["trust_reason"] is None
    assert target["email"] == regular_user.email


def test_search_users_403_for_regular_user(regular_user):
    response = client.get(
        f"/api/v1/admin/users?q={regular_user.username}",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_search_users_returns_empty_for_blank_query(admin_user):
    response = client.get("/api/v1/admin/users?q=", headers=login_as(client, admin_user))
    assert response.status_code == 200
    assert response.json() == []


def test_grant_trust_sets_flag_and_reason(admin_user, regular_user, db):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/trust",
        json={"is_trusted": True, "trust_reason": "Established OSINT track record"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_trusted"] is True
    assert body["trust_reason"] == "Established OSINT track record"

    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.is_trusted is True
    assert refreshed.trust_reason == "Established OSINT track record"

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "trust_granted")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {
        "user_id": str(regular_user.id),
        "trust_reason": "Established OSINT track record",
    }


def test_grant_trust_rejects_empty_reason(admin_user, regular_user):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/trust",
        json={"is_trusted": True, "trust_reason": "   "},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "trust_reason_required",
        "message": "trust_reason is required when granting trust",
    }


def test_revoke_trust_clears_reason(admin_user, regular_user, db):
    # First grant
    client.patch(
        f"/api/v1/admin/users/{regular_user.id}/trust",
        json={"is_trusted": True, "trust_reason": "Long-standing analyst"},
        headers=login_as(client, admin_user),
    )
    # Then revoke — body's trust_reason is intentionally ignored on revoke
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/trust",
        json={"is_trusted": False, "trust_reason": "shouldn't persist"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_trusted"] is False
    assert body["trust_reason"] is None

    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.trust_reason is None


def test_set_trust_403_for_regular_user(regular_user):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/trust",
        json={"is_trusted": True, "trust_reason": "x"},
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_set_trust_404_for_unknown_user(admin_user):
    response = client.patch(
        f"/api/v1/admin/users/{uuid.uuid4()}/trust",
        json={"is_trusted": True, "trust_reason": "x"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "user_not_found",
        "message": "User not found",
    }


@pytest.fixture
def geolocation(db, regular_user):
    geo = Geolocation(
        author_id=regular_user.id,
        title=f"Test geo {uuid.uuid4().hex[:8]}",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
    )
    db.add(geo)
    db.commit()
    geo_id = geo.id
    yield geo
    # Tests may have hard-deleted the row; bulk DELETE-by-id rather than
    # db.delete(instance), which would refresh a vanished row → ObjectDeletedError.
    db.expire_all()
    db.query(Geolocation).filter(Geolocation.id == geo_id).delete(synchronize_session=False)
    db.commit()


def test_soft_delete_geolocation_marks_deleted_at(admin_user, geolocation, db):
    response = client.delete(
        f"/api/v1/admin/geolocations/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "soft"
    assert body["deleted_at"] is not None
    assert body["geolocation_id"] == str(geolocation.id)

    db.expire_all()
    refreshed = db.query(Geolocation).filter(Geolocation.id == geolocation.id).first()
    assert refreshed is not None
    assert refreshed.deleted_at is not None


def test_soft_delete_writes_admin_event(admin_user, geolocation, db):
    client.delete(
        f"/api/v1/admin/geolocations/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "geolocation_soft_deleted",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {
        "geolocation_id": str(geolocation.id),
        "title": geolocation.title,
    }


def test_soft_delete_is_idempotent(admin_user, geolocation, db):
    first = client.delete(
        f"/api/v1/admin/geolocations/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    assert first.status_code == 200
    first_ts = first.json()["deleted_at"]

    second = client.delete(
        f"/api/v1/admin/geolocations/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    assert second.status_code == 200
    # Re-soft-delete preserves the original timestamp
    assert second.json()["deleted_at"] == first_ts

    # Only one audit row from the actual mutation
    events = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "geolocation_soft_deleted",
        )
        .all()
    )
    matching = [e for e in events if e.target.get("geolocation_id") == str(geolocation.id)]
    assert len(matching) == 1


def test_soft_deleted_row_hidden_from_public_reads(admin_user, geolocation):
    client.delete(
        f"/api/v1/admin/geolocations/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    # Detail
    detail = client.get(f"/api/v1/geolocations/{geolocation.id}")
    assert detail.status_code == 404


def test_soft_deleted_row_hidden_from_author_count(admin_user, regular_user, geolocation):
    before = client.get(f"/api/v1/users/{regular_user.username}").json()
    assert before["geolocations_count"] >= 1

    client.delete(
        f"/api/v1/admin/geolocations/{geolocation.id}",
        headers=login_as(client, admin_user),
    )

    after = client.get(f"/api/v1/users/{regular_user.username}").json()
    assert after["geolocations_count"] == before["geolocations_count"] - 1


def test_hard_delete_drops_row_and_writes_event(admin_user, geolocation, db):
    # Capture before the API removes the row — reading instance attrs after the
    # parallel session deletes it would refresh → ObjectDeletedError.
    geo_id = geolocation.id
    geo_title = geolocation.title

    response = client.delete(
        f"/api/v1/admin/geolocations/{geo_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "hard"
    assert body["deleted_at"] is None
    assert body["geolocation_id"] == str(geo_id)
    assert body["title"] == geo_title

    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.id == geo_id).first() is None

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.action == "geolocation_hard_deleted")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target["geolocation_id"] == str(geo_id)


def test_admin_geolocation_delete_403_for_regular_user(regular_user, geolocation):
    response = client.delete(
        f"/api/v1/admin/geolocations/{geolocation.id}",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_admin_geolocation_delete_404_for_unknown_id(admin_user):
    response = client.delete(
        f"/api/v1/admin/geolocations/{uuid.uuid4()}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "geolocation_not_found",
        "message": "Geolocation not found",
    }


def test_soft_delete_user_marks_deleted_at_and_cascades_geos(
    admin_user, regular_user, geolocation, db
):
    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "soft"
    assert body["deleted_at"] is not None
    assert body["cascaded_geolocations"] >= 1

    db.expire_all()
    refreshed_user = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed_user.deleted_at is not None
    refreshed_geo = db.query(Geolocation).filter(Geolocation.id == geolocation.id).first()
    assert refreshed_geo.deleted_at is not None


def test_soft_delete_user_blocks_login(admin_user, regular_user):
    # Set a known password so we can attempt login afterwards
    fresh = TestClient(app)
    # Soft-delete via admin
    fresh.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(fresh, admin_user),
    )
    # Attempt login — same opaque 401 as wrong credentials
    fresh.cookies.clear()
    response = fresh.post(
        "/api/v1/auth/login",
        json={"email": regular_user.email, "password": "password123"},
    )
    assert response.status_code == 401


def test_soft_delete_user_hides_profile(admin_user, regular_user):
    client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    response = client.get(f"/api/v1/users/{regular_user.username}")
    assert response.status_code == 404


def test_soft_delete_user_writes_admin_event(admin_user, regular_user, db):
    client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "user_soft_deleted",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target["user_id"] == str(regular_user.id)
    assert event.target["username"] == regular_user.username


def test_soft_delete_user_is_idempotent(admin_user, regular_user, db):
    first = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    second = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["deleted_at"] == second.json()["deleted_at"]
    # Second call should report 0 fresh cascades
    assert second.json()["cascaded_geolocations"] == 0


def test_hard_delete_user_drops_row_and_geolocations(admin_user, regular_user, geolocation, db):
    user_id = regular_user.id
    geo_id = geolocation.id

    response = client.delete(
        f"/api/v1/admin/users/{user_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "hard"
    assert body["deleted_at"] is None
    assert body["cascaded_geolocations"] >= 1

    db.expire_all()
    assert db.query(User).filter(User.id == user_id).first() is None
    assert db.query(Geolocation).filter(Geolocation.id == geo_id).first() is None

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.action == "user_hard_deleted")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target["user_id"] == str(user_id)


def test_hard_delete_user_preserves_invite_codes(admin_user, db):
    """Hard-deleting a user nulls their FK on `invite_codes` rather than
    cascading the rows away — the codes are part of the platform audit
    trail (who-joined-when), not personal data of the deleted user.
    """
    # Build a user, mint an invite code as them, then hard-delete the user
    user = User(
        username=f"audit-{uuid.uuid4().hex[:8]}",
        email=f"audit-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id

    # Mint a code attributed to this user (created_by FK)
    invite = InviteCode(code=f"audit-code-{uuid.uuid4().hex}", created_by=user_id)
    db.add(invite)
    db.commit()
    invite_id = invite.id

    response = client.delete(
        f"/api/v1/admin/users/{user_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200

    db.expire_all()
    assert db.query(User).filter(User.id == user_id).first() is None
    surviving = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    assert surviving is not None
    # FK was nulled, not cascade-deleted
    assert surviving.created_by is None

    db.delete(surviving)
    db.commit()


def test_admin_user_delete_403_for_regular_user(regular_user):
    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_admin_user_delete_404_for_unknown_id(admin_user):
    response = client.delete(
        f"/api/v1/admin/users/{uuid.uuid4()}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "user_not_found",
        "message": "User not found",
    }


def test_user_profile_carries_trust_fields(admin_user, regular_user):
    """Regression: `/users/{username}` was constructing `UserProfile(...)`
    by hand and didn't pass `is_trusted` / `trust_reason`. After the schema
    made both required, the route 500'd on serialization."""
    # Grant trust so the field is non-default
    client.patch(
        f"/api/v1/admin/users/{regular_user.id}/trust",
        json={"is_trusted": True, "trust_reason": "Cross-checks against satellite"},
        headers=login_as(client, admin_user),
    )

    response = client.get(f"/api/v1/users/{regular_user.username}")
    assert response.status_code == 200
    body = response.json()
    assert body["is_trusted"] is True
    assert body["trust_reason"] == "Cross-checks against satellite"
    # Regression-guard against the field set drifting again
    assert {
        "id",
        "username",
        "is_trusted",
        "trust_reason",
        "created_at",
        "geolocations_count",
    }.issubset(body.keys())


def test_search_users_excludes_soft_deleted(admin_user, regular_user, db):
    # Soft-delete the row directly so we don't depend on the admin DELETE
    # endpoint's behaviour for this assertion.
    regular_user.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.get(
        f"/api/v1/admin/users?q={regular_user.username}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    rows = response.json()
    assert all(r["id"] != str(regular_user.id) for r in rows)


def test_set_trust_404_for_soft_deleted_user(admin_user, regular_user, db):
    regular_user.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/trust",
        json={"is_trusted": True, "trust_reason": "should not apply"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404

    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.is_trusted is False
    assert refreshed.trust_reason is None


def test_login_runs_bcrypt_for_unknown_email(monkeypatch):
    # The unknown-email branch must still pay one bcrypt: without the dummy
    # verify, a missing user returns measurably faster than a wrong-password
    # attempt (timing oracle). A 401 assertion alone wouldn't catch a regression
    # that dropped the dummy hash, so assert verify_password was called.
    calls: list[tuple[str, str]] = []

    from app.routers import auth as auth_router

    real_verify = auth_router.verify_password

    def tracking_verify(plain: str, hashed: str) -> bool:
        calls.append((plain, hashed))
        return real_verify(plain, hashed)

    monkeypatch.setattr(auth_router, "verify_password", tracking_verify)

    fresh = TestClient(app)
    response = fresh.post(
        "/api/v1/auth/login",
        json={"email": f"nobody-{uuid.uuid4().hex}@example.com", "password": "whatever"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"
    assert len(calls) == 1
    # The hash passed in is the dummy, not a real user's hash.
    assert calls[0][1] == auth_router.DUMMY_PASSWORD_HASH


def test_login_runs_bcrypt_for_soft_deleted_user(monkeypatch, admin_user, regular_user):
    calls: list[tuple[str, str]] = []

    from app.routers import auth as auth_router

    real_verify = auth_router.verify_password

    def tracking_verify(plain: str, hashed: str) -> bool:
        calls.append((plain, hashed))
        return real_verify(plain, hashed)

    monkeypatch.setattr(auth_router, "verify_password", tracking_verify)

    fresh = TestClient(app)
    fresh.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(fresh, admin_user),
    )
    fresh.cookies.clear()
    # Both right-password and wrong-password against a soft-deleted user
    # return the same opaque 401 — and crucially both pay one bcrypt
    # against the dummy hash, not the real (still-live) password_hash row.
    for password in ("password123", "wrong-password"):
        response = fresh.post(
            "/api/v1/auth/login",
            json={"email": regular_user.email, "password": password},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid email or password"

    assert len(calls) == 2
    for _, hashed in calls:
        assert hashed == auth_router.DUMMY_PASSWORD_HASH


def test_create_unguarded_invite_code_route_is_gone(regular_user):
    response = client.post(
        "/api/v1/auth/invite-codes",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 404


def _seed_bounty(db, *, author_id: uuid.UUID) -> uuid.UUID:
    """Cheap inline requested-event (bounty) fixture — parity with the
    geolocation fixture pattern in this file. A bounty is a ``requested``
    ``Geolocation`` (no location) since the merge. Returns the row id; the
    caller relies on cascade-on-delete-from-user to clean up the row + its
    media."""
    bounty = Geolocation(
        author_id=author_id,
        requested_by_id=author_id,
        title=f"Bounty {uuid.uuid4().hex[:8]}",
        source_url="https://example.com/post",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
    )
    db.add(bounty)
    db.flush()
    db.add(
        Media(
            geolocation_id=bounty.id,
            storage_url=(f"http://localhost:8000/local-storage/bounty_uploads/{bounty.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    return bounty.id


def test_soft_delete_user_cascades_to_requested_events(admin_user, regular_user, db):
    """Banning a user must hide their requested events (bounties) from public
    reads the same way it hides their geolocations — leaving open requests on the
    queue for a banned author breaks the audit story (someone fulfils it, the
    trace points back to a user no one can see). Since the merge both are one
    table, so the single ``cascaded_geolocations`` count covers them."""
    bounty_id = _seed_bounty(db, author_id=regular_user.id)

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "soft"
    # One requested event flipped; the response no longer carries a separate
    # bounty tally (one event cascade covers requested + located rows).
    assert body["cascaded_geolocations"] >= 1
    assert "cascaded_bounties" not in body

    db.expire_all()
    cascaded = db.query(Geolocation).filter(Geolocation.id == bounty_id).one()
    assert cascaded.deleted_at is not None
    # Public list excludes the soft-deleted request.
    listing = client.get("/api/v1/bounties").json()
    assert all(row["id"] != str(bounty_id) for row in listing)


def test_soft_delete_user_cascade_count_is_idempotent(admin_user, regular_user, db):
    """Re-soft-deleting an already-soft-deleted user returns 0 cascades — the
    audit log captures only what *this* call actually flipped. The requested
    event counts in the same ``cascaded_geolocations`` tally as any located row."""
    _seed_bounty(db, author_id=regular_user.id)

    first = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    second = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["cascaded_geolocations"] >= 1
    assert second.json()["cascaded_geolocations"] == 0


def test_hard_delete_user_drops_requested_events(admin_user, regular_user, db):
    """GDPR erasure must take the requested events (bounties) with the user.
    Media rows cascade via the event FK; the S3 sweep happens after commit and is
    counted in ``media_count``."""
    bounty_id = _seed_bounty(db, author_id=regular_user.id)
    media_id = db.query(Media.id).filter(Media.geolocation_id == bounty_id).scalar()

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "hard"
    # The requested event is counted in the single geolocation cascade.
    assert body["cascaded_geolocations"] >= 1
    assert "cascaded_bounties" not in body
    # media_count includes the seeded request's media.
    assert body["media_count"] >= 1

    db.expire_all()
    assert db.query(Geolocation).filter(Geolocation.id == bounty_id).first() is None
    assert db.query(Media).filter(Media.id == media_id).first() is None


def test_soft_delete_user_writes_cascade_count_in_admin_event(admin_user, regular_user, db):
    """The audit row carries the cascade count so a future audit can answer "how
    many events did this ban take down?" without re-querying. Since the merge the
    requested events fold into ``cascaded_geolocations``."""
    _seed_bounty(db, author_id=regular_user.id)

    client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    event = (
        db.query(AdminEvent)
        .filter(
            AdminEvent.actor_id == admin_user.id,
            AdminEvent.action == "user_soft_deleted",
        )
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target["cascaded_geolocations"] >= 1
    assert "cascaded_bounties" not in event.target
