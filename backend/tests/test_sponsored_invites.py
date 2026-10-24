"""Sponsored invite codes: an analyst mints a handle-bound code from Settings,
capped per UTC day, and the account it creates keeps a link to its sponsor."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.invite_code import InviteCode
from app.models.pending_registration import PendingRegistration
from app.models.user import User
from app.routers import auth as auth_router
from app.services import email
from app.services.auth import hash_password
from app.services.auth_cookies import CSRF_HEADER
from app.services.sponsored_invites import DAILY_MINT_LIMIT
from tests.conftest import TEST_CSRF_TOKEN, login_as

client = TestClient(app, headers={CSRF_HEADER: TEST_CSRF_TOKEN})

_MINE = "/api/v1/users/me/invite-codes"


@pytest.fixture(autouse=True)
def _clear_cookies():
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
def user_ids(db):
    """Every account a test creates, reaped with its codes and audit rows."""
    ids: list[uuid.UUID] = []
    yield ids
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id.in_(ids)).delete(synchronize_session=False)
    codes = db.query(InviteCode.id).filter(InviteCode.created_by_id.in_(ids))
    db.query(PendingRegistration).filter(PendingRegistration.invite_code_id.in_(codes)).delete(
        synchronize_session=False
    )
    db.query(InviteCode).filter(InviteCode.created_by_id.in_(ids)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def make_user(db, user_ids):
    def factory(prefix: str = "sp", **kw) -> User:
        user = User(
            username=f"{prefix}{uuid.uuid4().hex[:8]}",
            email=f"{prefix}-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password("password123"),
            **kw,
        )
        db.add(user)
        db.commit()
        user_ids.append(user.id)
        return user

    return factory


@pytest.fixture
def sponsor(make_user):
    return make_user("spn")


@pytest.fixture
def admin(make_user):
    return make_user("spadm", is_admin=True)


def _handle() -> str:
    return f"h{uuid.uuid4().hex[:12]}"


def _mint(user: User, x_handle: str):
    return client.post(_MINE, json={"x_handle": x_handle}, headers=login_as(client, user))


def _today_start() -> datetime:
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def _seed_codes(db, sponsor: User, count: int, created_at: datetime) -> None:
    for _ in range(count):
        db.add(
            InviteCode(
                code=uuid.uuid4().hex,
                x_handle=_handle(),
                created_by_id=sponsor.id,
                created_at=created_at,
            )
        )
    db.commit()


def test_mint_binds_normalized_handle_records_sponsor_and_audits(sponsor, db):
    handle = _handle()
    response = _mint(sponsor, f"@{handle.upper()}")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["x_handle"] == handle
    assert body["status"] == "active"
    assert body["used_at"] is None
    assert body["link"].endswith(f"/register?code={body['code']}")

    invite = db.query(InviteCode).filter(InviteCode.id == uuid.UUID(body["id"])).one()
    assert invite.created_by_id == sponsor.id
    assert invite.x_handle == handle
    assert invite.expires_at is None

    audit = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == sponsor.id, AdminEvent.action == "invite_sponsored")
        .one()
    )
    assert audit.target == {"invite_code_id": body["id"], "x_handle": handle}


@pytest.mark.parametrize("bad", ["", "@", "has space", "a" * 16, "dash-ed"])
def test_mint_rejects_a_handle_outside_the_alphabet(sponsor, db, bad):
    response = _mint(sponsor, bad)
    assert response.status_code == 422
    assert db.query(InviteCode).filter(InviteCode.created_by_id == sponsor.id).count() == 0


def test_mint_requires_a_signed_in_user():
    response = client.post(_MINE, json={"x_handle": _handle()})
    assert response.status_code == 401


def test_sixth_mint_in_a_utc_day_is_refused_with_the_reset_time(sponsor, db):
    for _ in range(DAILY_MINT_LIMIT):
        assert _mint(sponsor, _handle()).status_code == 201

    response = _mint(sponsor, _handle())
    assert response.status_code == 429
    detail = response.json()["detail"]
    assert detail["code"] == "invite_quota_exceeded"
    resets_at = _today_start() + timedelta(days=1)
    assert f"{resets_at:%Y-%m-%d %H:%M} UTC" in detail["message"]
    assert db.query(InviteCode).filter(InviteCode.created_by_id == sponsor.id).count() == (
        DAILY_MINT_LIMIT
    )


def test_revoked_codes_still_count_against_their_day(sponsor, admin, db):
    ids = [_mint(sponsor, _handle()).json()["id"] for _ in range(DAILY_MINT_LIMIT)]
    headers = login_as(client, admin)
    for invite_id in ids:
        revoke = client.post(f"/api/v1/admin/invite-codes/{invite_id}/revoke", headers=headers)
        assert revoke.status_code == 200
        assert revoke.json()["sponsor"]["id"] == str(sponsor.id)

    response = _mint(sponsor, _handle())
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "invite_quota_exceeded"


def _revoke(user: User, code_id: str):
    return client.post(f"{_MINE}/{code_id}/revoke", headers=login_as(client, user))


def test_sponsor_revokes_own_active_code_with_an_audit_row(sponsor, db):
    minted = _mint(sponsor, _handle()).json()

    response = _revoke(sponsor, minted["id"])
    assert response.status_code == 200, response.text
    assert response.json()["id"] == minted["id"]
    assert response.json()["status"] == "revoked"

    invite = db.query(InviteCode).filter(InviteCode.id == uuid.UUID(minted["id"])).one()
    assert invite.revoked_at is not None
    audit = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == sponsor.id, AdminEvent.action == "invite_revoked")
        .one()
    )
    assert audit.target == {"invite_code_id": minted["id"]}


def test_sponsor_revoke_404s_another_sponsors_code_and_an_unknown_id(sponsor, make_user, db):
    minted = _mint(make_user("spo"), _handle()).json()

    for code_id in (minted["id"], str(uuid.uuid4())):
        response = _revoke(sponsor, code_id)
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "invite_code_not_found"
    invite = db.query(InviteCode).filter(InviteCode.id == uuid.UUID(minted["id"])).one()
    assert invite.revoked_at is None


def test_sponsor_revoke_refuses_a_used_or_revoked_code(sponsor, db):
    used = _mint(sponsor, _handle()).json()
    db.query(InviteCode).filter(InviteCode.id == uuid.UUID(used["id"])).update(
        {"used_at": datetime.now(UTC)}
    )
    db.commit()
    revoked = _mint(sponsor, _handle()).json()
    assert _revoke(sponsor, revoked["id"]).status_code == 200

    for code_id in (used["id"], revoked["id"]):
        response = _revoke(sponsor, code_id)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "invite_code_not_active"
    assert (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == sponsor.id, AdminEvent.action == "invite_revoked")
        .count()
        == 1
    )


def test_sponsor_revoked_codes_still_count_against_their_day(sponsor, db):
    ids = [_mint(sponsor, _handle()).json()["id"] for _ in range(DAILY_MINT_LIMIT)]
    for code_id in ids:
        assert _revoke(sponsor, code_id).status_code == 200

    response = _mint(sponsor, _handle())
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "invite_quota_exceeded"


def test_sponsor_revokes_with_minting_turned_off(sponsor, db):
    minted = _mint(sponsor, _handle()).json()
    sponsor.is_invite_minting_enabled = False
    db.commit()

    assert _revoke(sponsor, minted["id"]).status_code == 200


def test_quota_window_starts_at_midnight_utc(sponsor, db):
    _seed_codes(db, sponsor, DAILY_MINT_LIMIT, _today_start() - timedelta(microseconds=1))
    assert _mint(sponsor, _handle()).status_code == 201

    _seed_codes(db, sponsor, DAILY_MINT_LIMIT - 1, _today_start())
    assert _mint(sponsor, _handle()).status_code == 429


def test_list_returns_own_codes_and_quota_state(sponsor, make_user, admin, db):
    other = make_user("spo")
    assert _mint(other, _handle()).status_code == 201
    first = _mint(sponsor, _handle()).json()
    second = _mint(sponsor, _handle()).json()
    client.post(f"/api/v1/admin/invite-codes/{first['id']}/revoke", headers=login_as(client, admin))

    response = client.get(_MINE, headers=login_as(client, sponsor))
    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body["items"]] == [second["id"], first["id"]]
    assert [row["status"] for row in body["items"]] == ["active", "revoked"]
    assert body["minting_enabled"] is True
    assert body["daily_limit"] == DAILY_MINT_LIMIT
    assert body["minted_today"] == 2
    assert body["resets_at"].startswith((_today_start() + timedelta(days=1)).date().isoformat())


def test_admin_switch_turns_minting_off_and_on(sponsor, admin, db):
    path = f"/api/v1/admin/users/{sponsor.id}/invite-minting"
    response = client.patch(path, json={"enabled": False}, headers=login_as(client, admin))
    assert response.status_code == 200
    assert response.json()["is_invite_minting_enabled"] is False

    refused = _mint(sponsor, _handle())
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "invite_minting_disabled"
    listing = client.get(_MINE, headers=login_as(client, sponsor)).json()
    assert listing["minting_enabled"] is False

    response = client.patch(path, json={"enabled": True}, headers=login_as(client, admin))
    assert response.json()["is_invite_minting_enabled"] is True
    assert _mint(sponsor, _handle()).status_code == 201

    actions = [
        row.action
        for row in db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin.id)
        .order_by(AdminEvent.created_at.asc())
    ]
    assert actions == ["invite_minting_disabled", "invite_minting_enabled"]


def test_admin_switch_is_idempotent_without_a_second_audit_row(sponsor, admin, db):
    path = f"/api/v1/admin/users/{sponsor.id}/invite-minting"
    headers = login_as(client, admin)
    for _ in range(2):
        assert client.patch(path, json={"enabled": False}, headers=headers).status_code == 200
    assert db.query(AdminEvent).filter(AdminEvent.actor_id == admin.id).count() == 1


def test_admin_switch_is_admin_only_and_404s_an_unknown_user(sponsor, admin):
    path = f"/api/v1/admin/users/{sponsor.id}/invite-minting"
    response = client.patch(path, json={"enabled": False}, headers=login_as(client, sponsor))
    assert response.status_code == 403

    missing = f"/api/v1/admin/users/{uuid.uuid4()}/invite-minting"
    response = client.patch(missing, json={"enabled": False}, headers=login_as(client, admin))
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "user_not_found"


def test_redemption_links_the_handle_and_the_sponsor(sponsor, admin, user_ids, db, monkeypatch):
    sent: list[email.Email] = []
    monkeypatch.setattr(auth_router.email, "send", sent.append)
    handle = _handle()
    minted = _mint(sponsor, handle).json()
    client.cookies.clear()

    suffix = uuid.uuid4().hex[:10]
    payload = {
        "username": f"u{suffix}",
        "email": f"{suffix}@example.com",
        "password": "validpass123",
        "invite_code": minted["code"],
    }
    assert client.post("/api/v1/auth/register", json=payload).status_code == 202
    token = sent[0].text.split("?token=", 1)[1].split()[0]
    response = client.post("/api/v1/auth/confirm-registration", json={"token": token})
    assert response.status_code == 200, response.text

    invitee = db.query(User).filter(User.email == payload["email"]).one()
    user_ids.append(invitee.id)
    assert invitee.x_handle == handle
    assert invitee.sponsor is not None
    assert invitee.sponsor.id == sponsor.id

    headers = login_as(client, admin)
    found = client.get(f"/api/v1/admin/users?q={invitee.username}", headers=headers).json()
    assert found[0]["sponsor"]["username"] == sponsor.username
    assert found[0]["is_invite_minting_enabled"] is True

    codes = client.get("/api/v1/admin/invite-codes", headers=headers).json()
    row = next(code for code in codes if code["id"] == minted["id"])
    assert row["sponsor"]["username"] == sponsor.username
    assert row["redeemer"]["username"] == invitee.username

    listing = client.get(_MINE, headers=login_as(client, sponsor)).json()
    assert listing["items"][0]["status"] == "exhausted"


def test_admin_minted_code_has_no_sponsor(admin):
    response = client.post("/api/v1/admin/invite-codes", json={}, headers=login_as(client, admin))
    assert response.status_code == 201
    assert response.json()["sponsor"] is None
    client.delete(
        f"/api/v1/admin/invite-codes/{response.json()['id']}", headers=login_as(client, admin)
    )
