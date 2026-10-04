import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.config import settings
from app.database import SessionLocal
from app.dependencies import LAST_SEEN_THROTTLE
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.archive_import_job import ArchiveImportJob
from app.models.auth_event import EVENT_LOGIN, AuthEvent
from app.models.bot_mention import BotMention
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.user import User
from app.services import storage as storage_module
from app.services.auth import hash_password
from tests._fixtures import TINY_JPEG, store_bytes
from tests.conftest import login_as

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_test_client_cookies():
    """Wipe TestClient cookies between tests: a leftover cookie would authenticate the next test as a deleted user (spurious 401)."""
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
    # Reap this actor's admin events and redeemed invite codes so the row deletes without FK violations.
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id == user_id).delete()
    db.query(InviteCode).filter(InviteCode.used_by == user_id).delete()
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
    # Tests may have hard-deleted the row: bulk delete by id (``db.delete(instance)`` would raise ObjectDeletedError).
    # Drop the user's events first so the users.id FK does not block (media/claims cascade).
    db.expire_all()
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(Event).filter(Event.requested_by_id == user_id).delete(synchronize_session=False)
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
    # Codes are single-use: each names exactly one analyst.
    assert body["status"] == "active"
    assert body["expires_at"] is not None
    assert body["redeemer"] is None

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


def test_create_invite_code_binds_x_handle_stripped_and_lowercased(admin_user, db):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"x_handle": "@Invited_Analyst"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["x_handle"] == "invited_analyst"

    invite = db.query(InviteCode).filter(InviteCode.id == uuid.UUID(body["id"])).first()
    assert invite is not None
    assert invite.x_handle == "invited_analyst"

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "invite_created")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {"invite_code_id": body["id"], "x_handle": "invited_analyst"}


def test_create_invite_code_defaults_to_no_x_handle(admin_user):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    assert response.json()["x_handle"] is None


def test_create_invite_code_409_when_x_handle_already_linked(admin_user, regular_user, db):
    regular_user.x_handle = f"taken{uuid.uuid4().hex[:8]}"
    db.commit()
    try:
        response = client.post(
            "/api/v1/admin/invite-codes",
            json={"x_handle": regular_user.x_handle},
            headers=login_as(client, admin_user),
        )
        assert response.status_code == 409
        assert response.json()["detail"] == {
            "code": "x_handle_conflict",
            "message": "x_handle is already linked to another account",
        }
    finally:
        regular_user.x_handle = None
        db.commit()


def test_create_invite_code_422_on_invalid_x_handle(admin_user):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"x_handle": "not a handle!"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 422


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


def test_list_invite_codes_pages_on_a_cursor(admin_user):
    """The append-only invite table is read a bounded page at a time."""
    headers = login_as(client, admin_user)
    created = set()
    for _ in range(3):
        created.add(
            client.post("/api/v1/admin/invite-codes", json={}, headers=headers).json()["id"]
        )

    first = client.get("/api/v1/admin/invite-codes?limit=2", headers=headers)
    assert first.status_code == 200
    assert len(first.json()) == 2
    link = first.headers["Link"]
    assert link.endswith('; rel="next"')

    second = client.get(link[1 : link.index(">")].replace("http://testserver", ""), headers=headers)
    assert second.status_code == 200
    walked = [row["id"] for row in first.json()] + [row["id"] for row in second.json()]
    assert len(walked) == len(set(walked)), "a row was served twice"
    assert created <= set(walked)


def test_list_invite_codes_rejects_garbage_paging(admin_user):
    headers = login_as(client, admin_user)
    for query in ("limit=0", "limit=abc", "cursor=garbage"):
        response = client.get(f"/api/v1/admin/invite-codes?{query}", headers=headers)
        assert response.status_code == 422, f"expected 422 for {query!r}"


def test_revoke_invite_code_marks_revoked(admin_user):
    create_response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    invite_id = create_response.json()["id"]

    revoke_response = client.post(
        f"/api/v1/admin/invite-codes/{invite_id}/revoke",
        headers=login_as(client, admin_user),
    )
    assert revoke_response.status_code == 200
    body = revoke_response.json()
    assert body["status"] == "revoked"


def test_revoke_invite_code_returns_404_for_unknown_id(admin_user):
    response = client.post(
        f"/api/v1/admin/invite-codes/{uuid.uuid4()}/revoke",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404


def test_delete_invite_code_drops_an_unused_row(admin_user, db):
    headers = login_as(client, admin_user)
    created = client.post("/api/v1/admin/invite-codes", json={}, headers=headers).json()
    invite_id = uuid.UUID(created["id"])

    response = client.delete(f"/api/v1/admin/invite-codes/{invite_id}", headers=headers)

    assert response.status_code == 204
    assert response.content == b""
    db.expire_all()
    assert db.query(InviteCode).filter(InviteCode.id == invite_id).first() is None


def test_delete_invite_code_writes_admin_event_carrying_the_code(admin_user, db):
    headers = login_as(client, admin_user)
    created = client.post("/api/v1/admin/invite-codes", json={}, headers=headers).json()

    client.delete(f"/api/v1/admin/invite-codes/{created['id']}", headers=headers)

    db.expire_all()
    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "invite_deleted")
        .one()
    )
    assert event.target == {"invite_code_id": created["id"], "code": created["code"]}


def test_delete_invite_code_revoked_but_unused_is_allowed(admin_user, db):
    headers = login_as(client, admin_user)
    created = client.post("/api/v1/admin/invite-codes", json={}, headers=headers).json()
    invite_id = uuid.UUID(created["id"])
    client.post(f"/api/v1/admin/invite-codes/{invite_id}/revoke", headers=headers)

    response = client.delete(f"/api/v1/admin/invite-codes/{invite_id}", headers=headers)

    assert response.status_code == 204
    db.expire_all()
    assert db.query(InviteCode).filter(InviteCode.id == invite_id).first() is None


def test_delete_invite_code_409_when_redeemed(admin_user, regular_user, db):
    invite = InviteCode(
        code=f"code{uuid.uuid4().hex[:12]}",
        used_by=regular_user.id,
        used_at=datetime.now(UTC),
    )
    db.add(invite)
    db.commit()
    invite_id = invite.id
    try:
        response = client.delete(
            f"/api/v1/admin/invite-codes/{invite_id}",
            headers=login_as(client, admin_user),
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "invite_code_used"
        db.expire_all()
        assert db.query(InviteCode).filter(InviteCode.id == invite_id).first() is not None
    finally:
        db.expire_all()
        db.query(InviteCode).filter(InviteCode.id == invite_id).delete()
        db.commit()


def test_delete_invite_code_returns_404_for_unknown_id(admin_user):
    response = client.delete(
        f"/api/v1/admin/invite-codes/{uuid.uuid4()}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404


def test_list_invite_codes_carries_redeemer_onboarding_stats(admin_user, regular_user, db):
    handle = f"redeem{uuid.uuid4().hex[:8]}"
    regular_user.x_handle = handle
    invite = InviteCode(
        code=f"code{uuid.uuid4().hex[:12]}",
        used_by=regular_user.id,
        used_at=datetime.now(UTC),
    )
    job = ArchiveImportJob(
        owner_id=regular_user.id, zip_key=f"staging/{uuid.uuid4().hex}.zip", status="done"
    )
    mention = BotMention(
        mention_tweet_id=uuid.uuid4().hex[:19],
        author_handle=handle.upper(),
        outcome="created",
        events_created=3,
    )
    detected = Event(
        owner_id=regular_user.id,
        title=f"Detection {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
    )
    geolocated = Event(
        owner_id=regular_user.id,
        title=f"Located {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.6, 48.6), srid=4326),
        source_url="https://example.com/source",
        geolocated_at=datetime.now(UTC),
    )
    login_event = AuthEvent(user_id=regular_user.id, event=EVENT_LOGIN)
    db.add_all([invite, job, mention, detected, geolocated, login_event])
    db.commit()
    try:
        rows = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user)).json()
        row = next(r for r in rows if r["code"] == invite.code)
        redeemer = row["redeemer"]
        assert redeemer["username"] == regular_user.username
        assert redeemer["x_handle"] == handle
        assert redeemer["archives_imported"] == 1
        # Case-insensitive handle match.
        assert redeemer["bot_detection_count"] == 3
        assert redeemer["detected_count"] == 1
        assert redeemer["geolocated_count"] == 1
        # ``last_seen_at`` is NULL for a user with no authenticated request: the read falls back to the login event.
        assert regular_user.last_seen_at is None
        assert redeemer["last_seen_at"] is not None
    finally:
        db.expire_all()
        db.query(InviteCode).filter(InviteCode.id == invite.id).delete()
        db.query(ArchiveImportJob).filter(ArchiveImportJob.owner_id == regular_user.id).delete()
        db.query(BotMention).filter(BotMention.id == mention.id).delete()
        db.query(AuthEvent).filter(AuthEvent.user_id == regular_user.id).delete()
        regular_user.x_handle = None
        db.commit()


def _redeem(db, user: User) -> InviteCode:
    """Bind a fresh invite code to ``user`` so the onboarding list carries them."""
    invite = InviteCode(
        code=f"code{uuid.uuid4().hex[:12]}",
        used_by=user.id,
        used_at=datetime.now(UTC),
    )
    db.add(invite)
    db.commit()
    return invite


def _stored_last_seen(db, user: User) -> datetime | None:
    """``users.last_seen_at`` re-read from the row, not from a stale identity map."""
    db.expire_all()
    return db.query(User.last_seen_at).filter(User.id == user.id).scalar()


def test_authenticated_request_stamps_last_seen_and_the_onboarding_row_reads_it(
    admin_user, regular_user, db
):
    invite = _redeem(db, regular_user)
    try:
        assert (
            client.get("/api/v1/auth/me", headers=login_as(client, regular_user)).status_code == 200
        )
        stamped = _stored_last_seen(db, regular_user)
        assert stamped is not None
        client.cookies.clear()

        rows = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user)).json()
        row = next(r for r in rows if r["code"] == invite.code)
        assert datetime.fromisoformat(row["redeemer"]["last_seen_at"]) == stamped
    finally:
        db.expire_all()
        db.query(InviteCode).filter(InviteCode.id == invite.id).delete()
        db.commit()


def test_last_seen_is_rewritten_once_per_throttle_window(regular_user, db):
    """A second request inside the window costs no UPDATE; one past it stamps again."""
    headers = login_as(client, regular_user)
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    first = _stored_last_seen(db, regular_user)
    assert first is not None

    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert _stored_last_seen(db, regular_user) == first

    # Age the stored value past the window; the next request has to move it.
    stale = datetime.now(UTC) - LAST_SEEN_THROTTLE - timedelta(minutes=1)
    db.query(User).filter(User.id == regular_user.id).update({User.last_seen_at: stale})
    db.commit()
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    refreshed = _stored_last_seen(db, regular_user)
    assert refreshed is not None and refreshed > stale


def test_onboarding_row_falls_back_to_the_newest_login_event_when_last_seen_is_null(
    admin_user, regular_user, db
):
    """A row predating the column carries no stamp, so the auth log stands in."""
    invite = _redeem(db, regular_user)
    now = datetime.now(UTC)
    older = AuthEvent(
        user_id=regular_user.id, event=EVENT_LOGIN, created_at=now - timedelta(days=3)
    )
    newest = AuthEvent(
        user_id=regular_user.id, event=EVENT_LOGIN, created_at=now - timedelta(days=1)
    )
    db.add_all([older, newest])
    db.commit()
    try:
        assert _stored_last_seen(db, regular_user) is None
        rows = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user)).json()
        row = next(r for r in rows if r["code"] == invite.code)
        assert datetime.fromisoformat(row["redeemer"]["last_seen_at"]) == newest.created_at
    finally:
        db.expire_all()
        db.query(AuthEvent).filter(AuthEvent.user_id == regular_user.id).delete()
        db.query(InviteCode).filter(InviteCode.id == invite.id).delete()
        db.commit()


def test_purge_detected_events_sweeps_detections_and_keeps_the_rest(admin_user, regular_user, db):
    detected = Event(
        owner_id=regular_user.id,
        title=f"Detection {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=datetime.now(UTC),
    )
    geolocated = Event(
        owner_id=regular_user.id,
        title=f"Located {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.6, 48.6), srid=4326),
        source_url="https://example.com/source",
        geolocated_at=datetime.now(UTC),
    )
    db.add_all([detected, geolocated])
    db.commit()
    detected_id, geolocated_id = detected.id, geolocated.id

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}/detected-events",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == regular_user.username
    assert body["deleted_events"] == 1

    db.expire_all()
    assert db.query(Event).filter(Event.id == detected_id).first() is None
    assert db.query(Event).filter(Event.id == geolocated_id).first() is not None
    assert db.query(User).filter(User.id == regular_user.id).first() is not None

    audit = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "detected_events_purged")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert audit is not None
    assert audit.target["deleted_events"] == 1


def test_purge_detected_events_404_for_unknown_user(admin_user):
    response = client.delete(
        f"/api/v1/admin/users/{uuid.uuid4()}/detected-events",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404


def test_purge_detected_events_403_for_regular_user(regular_user):
    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}/detected-events",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_login_auto_promotes_when_email_matches_admin_emails(monkeypatch, db):
    # EmailStr rejects the .test TLD; use @example.com.
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
    target = next(r for r in rows if r["id"] == str(regular_user.id))
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


def test_set_x_handle_normalizes_and_writes_audit(admin_user, regular_user, db):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": "@OSINT_Hawk"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert response.json()["x_handle"] == "osint_hawk"

    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.x_handle == "osint_hawk"

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "x_handle_linked")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {"user_id": str(regular_user.id), "x_handle": "osint_hawk"}


def test_set_x_handle_accepts_bare_handle(admin_user, regular_user):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": "plain_handle"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert response.json()["x_handle"] == "plain_handle"


def test_clear_x_handle_with_null(admin_user, regular_user, db):
    client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": "to_clear"},
        headers=login_as(client, admin_user),
    )
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": None},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert response.json()["x_handle"] is None

    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.x_handle is None

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "x_handle_cleared")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target == {"user_id": str(regular_user.id)}


def test_set_x_handle_409_when_linked_to_another_user(admin_user, regular_user, db):
    holder = User(
        username=f"holder{uuid.uuid4().hex[:8]}",
        email=f"holder-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        x_handle=f"held{uuid.uuid4().hex[:8]}",
    )
    db.add(holder)
    db.commit()
    holder_id = holder.id
    held_handle = holder.x_handle

    try:
        response = client.patch(
            f"/api/v1/admin/users/{regular_user.id}/x-handle",
            json={"x_handle": held_handle},
            headers=login_as(client, admin_user),
        )
        assert response.status_code == 409
        assert response.json()["detail"] == {
            "code": "x_handle_conflict",
            "message": "x_handle is already linked to another account",
        }
        db.expire_all()
        refreshed = db.query(User).filter(User.id == regular_user.id).first()
        assert refreshed.x_handle is None
    finally:
        db.query(User).filter(User.id == holder_id).delete(synchronize_session=False)
        db.commit()


@pytest.mark.parametrize(
    "bad_handle",
    ["", "@", "with space", "hyphen-ated", "waytoolonghandle1", "@@double", "émoji"],
)
def test_set_x_handle_422_on_invalid_handle(admin_user, regular_user, bad_handle):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": bad_handle},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 422


def test_set_x_handle_404_for_soft_deleted_user(admin_user, regular_user, db):
    regular_user.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": "some_handle"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404


def test_set_x_handle_403_for_regular_user(regular_user):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": "some_handle"},
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


@pytest.fixture
def geolocation(db, regular_user):
    geo = Event(
        owner_id=regular_user.id,
        title=f"Test geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add(geo)
    db.commit()
    geo_id = geo.id
    yield geo
    # Tests may have hard-deleted the row: bulk delete by id (``db.delete(instance)`` would raise ObjectDeletedError).
    db.expire_all()
    db.query(Event).filter(Event.id == geo_id).delete(synchronize_session=False)
    db.commit()


def test_soft_delete_geolocation_marks_deleted_at(admin_user, geolocation, db):
    response = client.delete(
        f"/api/v1/admin/events/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "soft"
    assert body["deleted_at"] is not None
    assert body["geolocation_id"] == str(geolocation.id)

    db.expire_all()
    refreshed = db.query(Event).filter(Event.id == geolocation.id).first()
    assert refreshed is not None
    assert refreshed.deleted_at is not None


def test_soft_delete_writes_admin_event(admin_user, geolocation, db):
    client.delete(
        f"/api/v1/admin/events/{geolocation.id}",
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
        f"/api/v1/admin/events/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    assert first.status_code == 200
    first_ts = first.json()["deleted_at"]

    second = client.delete(
        f"/api/v1/admin/events/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    assert second.status_code == 200
    assert second.json()["deleted_at"] == first_ts

    # One audit row from the mutation.
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
        f"/api/v1/admin/events/{geolocation.id}",
        headers=login_as(client, admin_user),
    )
    detail = client.get(f"/api/v1/events/{geolocation.id}")
    assert detail.status_code == 404


def test_soft_deleted_row_hidden_from_author_count(admin_user, regular_user, geolocation):
    before = client.get(f"/api/v1/users/{regular_user.username}").json()
    assert before["geolocations_count"] >= 1

    client.delete(
        f"/api/v1/admin/events/{geolocation.id}",
        headers=login_as(client, admin_user),
    )

    after = client.get(f"/api/v1/users/{regular_user.username}").json()
    assert after["geolocations_count"] == before["geolocations_count"] - 1


def test_hard_delete_drops_row_and_writes_event(admin_user, geolocation, db):
    # Capture before the API removes the row (a refresh after deletion raises ObjectDeletedError).
    geo_id = geolocation.id
    geo_title = geolocation.title

    response = client.delete(
        f"/api/v1/admin/events/{geo_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "hard"
    assert body["deleted_at"] is None
    assert body["geolocation_id"] == str(geo_id)
    assert body["title"] == geo_title

    db.expire_all()
    assert db.query(Event).filter(Event.id == geo_id).first() is None

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.action == "geolocation_hard_deleted")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target["geolocation_id"] == str(geo_id)


def test_hard_delete_sweeps_source_image_derivatives(admin_user, geolocation, db, monkeypatch):
    """GDPR erasure leaves nothing on S3: a ``source`` image's ``_hero`` / ``_thumb`` keys reach the sweep too."""
    geo_id = geolocation.id
    db.add(
        Media(
            event_id=geo_id,
            role="source",
            storage_url=f"http://localhost:8000/local-storage/uploads/{geo_id}/photo.png",
            media_type="image",
        )
    )
    db.commit()

    swept: list[str] = []
    monkeypatch.setattr(
        "app.services.admin.sweep_keys",
        lambda keys, *, context: swept.extend(keys),
    )

    response = client.delete(
        f"/api/v1/admin/events/{geo_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200

    assert set(swept) == {
        f"uploads/{geo_id}/photo.png",
        f"uploads/{geo_id}/photo_hero.jpg",
        f"uploads/{geo_id}/photo_thumb.jpg",
    }


def test_hard_delete_user_sweeps_source_image_derivatives(
    admin_user, regular_user, db, monkeypatch
):
    """Same derivative coverage on user-level erasure."""
    request_id = _seed_request(db, author_id=regular_user.id)

    swept: list[str] = []
    monkeypatch.setattr(
        "app.services.admin.sweep_keys",
        lambda keys, *, context: swept.extend(keys),
    )

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200

    assert f"request_uploads/{request_id}/x_hero.jpg" in swept
    assert f"request_uploads/{request_id}/x_thumb.jpg" in swept
    assert response.json()["media_count"] == len(swept)


def test_hard_delete_user_sweeps_their_avatar(admin_user, regular_user, db, monkeypatch, tmp_path):
    """The profile picture is personal data: it is erased with the account, not left addressable."""
    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))

    storage = storage_module.get_storage()
    key = f"avatars/{regular_user.id}/{uuid.uuid4()}.jpg"
    store_bytes(TINY_JPEG, key)
    stored = tmp_path / key
    assert stored.is_file()

    regular_user.avatar_url = storage.public_url(key)
    db.commit()

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert not stored.exists()


def test_admin_geolocation_delete_403_for_regular_user(regular_user, geolocation):
    response = client.delete(
        f"/api/v1/admin/events/{geolocation.id}",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_admin_geolocation_delete_404_for_unknown_id(admin_user):
    response = client.delete(
        f"/api/v1/admin/events/{uuid.uuid4()}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404
    assert response.json()["detail"] == {
        "code": "geolocation_not_found",
        "message": "Event not found",
    }


def test_soft_delete_user_marks_deleted_at_and_cascades_geos(
    admin_user, regular_user, geolocation, db
):
    regular_user.x_handle = f"freed{uuid.uuid4().hex[:8]}"
    db.commit()

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
    # The handle is released with the tombstone (the UNIQUE spans tombstoned rows and PATCH refuses them).
    assert refreshed_user.x_handle is None
    refreshed_geo = db.query(Event).filter(Event.id == geolocation.id).first()
    assert refreshed_geo.deleted_at is not None


def test_soft_delete_user_blocks_login(admin_user, regular_user):
    fresh = TestClient(app)
    fresh.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(fresh, admin_user),
    )
    # Same opaque 401 as wrong credentials.
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
    assert db.query(Event).filter(Event.id == geo_id).first() is None

    event = (
        db.query(AdminEvent)
        .filter(AdminEvent.action == "user_hard_deleted")
        .order_by(AdminEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.target["user_id"] == str(user_id)


def test_hard_delete_user_who_requested_a_fulfilled_event(admin_user, regular_user, db):
    """Regression: hard-erasing a requester whose request another user fulfilled succeeds; ``requested_by_id`` is ON DELETE SET NULL and the attribution is nulled instead of 500ing."""
    fulfiller = User(
        username=f"fulf-{uuid.uuid4().hex[:8]}",
        email=f"fulf-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(fulfiller)
    db.flush()
    event = Event(
        owner_id=fulfiller.id,  # ownership transferred to the fulfiller at geolocate
        requested_by_id=regular_user.id,  # the requester we will hard-delete
        title=f"Fulfilled {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add(event)
    db.commit()
    event_id = event.id
    fulfiller_id = fulfiller.id
    requester_id = regular_user.id

    response = client.delete(
        f"/api/v1/admin/users/{requester_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.query(User).filter(User.id == requester_id).first() is None
    surviving = db.query(Event).filter(Event.id == event_id).one()
    assert surviving.owner_id == fulfiller_id
    assert surviving.requested_by_id is None

    # Detach stale instances (the fulfiller's event references the deleted requester), then bulk delete by id.
    db.expunge_all()
    db.query(Event).filter(Event.id == event_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == fulfiller_id).delete(synchronize_session=False)
    db.commit()


def test_soft_delete_user_hides_requested_by_from_reads(admin_user, regular_user, db):
    """Regression: soft-deleting a requester whose request another user fulfilled must not leak the banned account in ``requested_by`` of the live event; the read path nulls it."""
    fulfiller = User(
        username=f"fulf-{uuid.uuid4().hex[:8]}",
        email=f"fulf-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(fulfiller)
    db.flush()
    event = Event(
        owner_id=fulfiller.id,
        requested_by_id=regular_user.id,
        title=f"Fulfilled {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    db.add(event)
    db.commit()
    event_id = event.id
    fulfiller_id = fulfiller.id

    before = client.get(f"/api/v1/events/{event_id}")
    assert before.status_code == 200
    assert before.json()["requested_by"]["username"] == regular_user.username

    client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )

    after = client.get(f"/api/v1/events/{event_id}")
    assert after.status_code == 200
    assert after.json()["requested_by"] is None

    # Detach stale instances (the fulfiller's event references the deleted requester), then bulk delete by id.
    db.expunge_all()
    db.query(Event).filter(Event.id == event_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == fulfiller_id).delete(synchronize_session=False)
    db.commit()


def test_hard_delete_user_preserves_invite_codes(admin_user, db):
    """Hard-deleting a user nulls their FK on ``invite_codes`` instead of cascading: the codes are platform audit trail, not the user's personal data."""
    user = User(
        username=f"audit-{uuid.uuid4().hex[:8]}",
        email=f"audit-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id

    invite = InviteCode(code=f"audit-code-{uuid.uuid4().hex}", used_by=user_id)
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
    assert surviving.used_by is None

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


def test_user_profile_carries_expected_field_set(regular_user):
    """`/users/{username}` builds `UserProfile(...)` by hand: a required field the route forgets to pass 500s on serialization."""
    response = client.get(f"/api/v1/users/{regular_user.username}")
    assert response.status_code == 200
    body = response.json()
    assert {
        "id",
        "username",
        "avatar_url",
        "created_at",
        "geolocations_count",
    }.issubset(body.keys())


def test_search_users_excludes_soft_deleted(admin_user, regular_user, db):
    # Soft-delete directly, independent of the admin DELETE endpoint.
    regular_user.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.get(
        f"/api/v1/admin/users?q={regular_user.username}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    rows = response.json()
    assert all(r["id"] != str(regular_user.id) for r in rows)


def test_login_runs_bcrypt_for_unknown_email(monkeypatch):
    # The unknown-email branch must still pay one bcrypt, else a missing user answers measurably
    # faster than a wrong password (timing oracle). Assert verify_password was called.
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
    # Right and wrong password against a soft-deleted user both return the same opaque 401
    # and both pay one bcrypt against the dummy hash.
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


def _seed_request(db, *, author_id: uuid.UUID) -> uuid.UUID:
    """Inline requested-event fixture (a ``requested`` Event with no location); returns the row id, cleanup cascades from the user."""
    request = Event(
        owner_id=author_id,
        requested_by_id=author_id,
        title=f"Request {uuid.uuid4().hex[:8]}",
        source_url="https://example.com/post",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        status=STATUS_REQUESTED,
        requested_at=datetime.now(UTC),
    )
    db.add(request)
    db.flush()
    db.add(
        Media(
            event_id=request.id,
            role="source",
            storage_url=(f"http://localhost:8000/local-storage/request_uploads/{request.id}/x.jpg"),
            media_type="image",
        )
    )
    db.commit()
    return request.id


def test_soft_delete_user_cascades_to_requested_events(admin_user, regular_user, db):
    """Banning a user hides their requested events from public reads like their geolocations; one ``cascaded_geolocations`` count covers both."""
    request_id = _seed_request(db, author_id=regular_user.id)

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "soft"
    # One requested event flipped.
    assert body["cascaded_geolocations"] >= 1
    assert "cascaded_requests" not in body

    db.expire_all()
    cascaded = db.query(Event).filter(Event.id == request_id).one()
    assert cascaded.deleted_at is not None
    listing = client.get("/api/v1/events?view=requested").json()
    assert all(row["id"] != str(request_id) for row in listing)


def test_soft_delete_user_cascade_count_is_idempotent(admin_user, regular_user, db):
    """Re-soft-deleting a soft-deleted user returns 0 cascades: the audit log records only what this call flipped."""
    _seed_request(db, author_id=regular_user.id)

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
    """GDPR erasure takes the requested events with the user; media cascade via the event FK, the S3 sweep runs after commit and is counted in ``media_count``."""
    request_id = _seed_request(db, author_id=regular_user.id)
    media_id = db.query(Media.id).filter(Media.event_id == request_id).scalar()

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "hard"
    # Counted in the single geolocation cascade.
    assert body["cascaded_geolocations"] >= 1
    assert "cascaded_requests" not in body
    assert body["media_count"] >= 1

    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).first() is None
    assert db.query(Media).filter(Media.id == media_id).first() is None


def test_soft_delete_user_writes_cascade_count_in_admin_event(admin_user, regular_user, db):
    """The audit row carries the cascade count (requested events included in ``cascaded_geolocations``)."""
    _seed_request(db, author_id=regular_user.id)

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
    assert "cascaded_requests" not in event.target


@pytest.fixture
def events_cleanup(db):
    """Collect event ids created inline by a test and drop them on teardown (media cascades via the FK).

    The suite shares one database, so the stats tests assert deltas from a baseline.
    """
    ids: list[uuid.UUID] = []
    yield ids
    if ids:
        db.expire_all()
        db.query(Media).filter(Media.event_id.in_(ids)).delete(synchronize_session=False)
        db.query(Event).filter(Event.id.in_(ids)).delete(synchronize_session=False)
        db.commit()


def _detection_stats(admin_user):
    response = client.get(
        "/api/v1/admin/detection-stats",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_detection_stats_403_for_regular_user(regular_user):
    response = client.get(
        "/api/v1/admin/detection-stats",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 403


def test_detection_stats_401_for_anonymous():
    response = client.get("/api/v1/admin/detection-stats")
    assert response.status_code == 401


def test_reject_rate_counts_closed_detections_not_geolocated(
    admin_user, regular_user, events_cleanup, db
):
    """A machine detection closed straight out of ``detected`` is a reject; one promoted to ``geolocated`` or still pending is not. All three lift ``machine_total`` (``detected_from_url`` set)."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    rejected = Event(
        owner_id=regular_user.id,
        title=f"Rejected {uuid.uuid4().hex[:8]}",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
        closed_at=now,
        detected_at=now,
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
    )
    geolocated = Event(
        owner_id=regular_user.id,
        title=f"Geolocated {uuid.uuid4().hex[:8]}",
        status=STATUS_GEOLOCATED,
        geolocated_at=now,
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
    )
    pending = Event(
        owner_id=regular_user.id,
        title=f"Pending {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=now,
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
    )
    db.add_all([rejected, geolocated, pending])
    db.commit()
    events_cleanup.extend([rejected.id, geolocated.id, pending.id])

    after = _detection_stats(admin_user)

    assert after["machine_total"] == before["machine_total"] + 3
    assert after["machine_rejected"] == before["machine_rejected"] + 1
    assert after["machine_total"] > 0
    assert abs(after["reject_rate"] - after["machine_rejected"] / after["machine_total"]) < 1e-9


def test_reject_rate_ignores_human_submits(admin_user, regular_user, events_cleanup, db):
    """A human submit (``detected_from_url`` NULL) moves neither ``machine_total`` nor ``machine_rejected``, even when closed."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    human_closed = Event(
        owner_id=regular_user.id,
        title=f"Human closed {uuid.uuid4().hex[:8]}",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_REQUESTED,
        closed_at=now,
        source_url="https://example.com/source",
        requested_at=now,
    )
    db.add(human_closed)
    db.commit()
    events_cleanup.append(human_closed.id)

    after = _detection_stats(admin_user)
    assert after["machine_total"] == before["machine_total"]
    assert after["machine_rejected"] == before["machine_rejected"]


def test_reject_rate_ignores_a_bot_opened_request(admin_user, regular_user, events_cleanup, db):
    """A bot-opened request carries ``detected_from_url`` and ``requested_at``; the stamp keeps it out of the cohort for its whole life (footage awaiting geolocation, not an extraction)."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    closed_request = Event(
        owner_id=regular_user.id,
        requested_by_id=regular_user.id,
        title=f"Bot request closed {uuid.uuid4().hex[:8]}",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_REQUESTED,
        closed_at=now,
        requested_at=now,
        source_url="https://t.me/wilddivision82/351",
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
        detected_via="bot",
    )
    fulfilled_request = Event(
        owner_id=regular_user.id,
        requested_by_id=regular_user.id,
        title=f"Bot request fulfilled {uuid.uuid4().hex[:8]}",
        status=STATUS_GEOLOCATED,
        geolocated_at=now,
        requested_at=now,
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://t.me/wilddivision82/352",
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
        detected_via="bot",
    )
    db.add_all([closed_request, fulfilled_request])
    db.commit()
    events_cleanup.extend([closed_request.id, fulfilled_request.id])

    after = _detection_stats(admin_user)
    assert after["machine_total"] == before["machine_total"]
    assert after["machine_rejected"] == before["machine_rejected"]


def test_pending_quality_counts_missing_pieces(admin_user, regular_user, events_cleanup, db):
    """The pending counts flag live detections missing a source media, a proof image, or a source URL; a complete one lifts only ``pending``."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    bare = Event(
        owner_id=regular_user.id,
        title=f"Bare {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=now,
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
    )
    complete = Event(
        owner_id=regular_user.id,
        title=f"Complete {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=now,
        source_url="https://example.com/source",
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
    )
    db.add_all([bare, complete])
    db.flush()
    db.add_all(
        [
            Media(
                event_id=complete.id,
                role="source",
                storage_url=f"http://localhost:8000/local-storage/x/{complete.id}/s.jpg",
                media_type="image",
            ),
            Media(
                event_id=complete.id,
                role="proof",
                storage_url=f"http://localhost:8000/local-storage/x/{complete.id}/p.jpg",
                media_type="image",
            ),
        ]
    )
    db.commit()
    events_cleanup.extend([bare.id, complete.id])

    after = _detection_stats(admin_user)

    assert after["pending"] == before["pending"] + 2
    assert after["pending_missing_source_media"] == before["pending_missing_source_media"] + 1
    assert after["pending_missing_proof_image"] == before["pending_missing_proof_image"] + 1
    assert after["pending_missing_source_url"] == before["pending_missing_source_url"] + 1


def test_pending_counts_exclude_soft_deleted(admin_user, regular_user, events_cleanup, db):
    """A soft-deleted ``detected`` row leaves the pending queue and its missing-piece tallies."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    soft_deleted = Event(
        owner_id=regular_user.id,
        title=f"Soft-deleted {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=now,
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
        deleted_at=now,
    )
    db.add(soft_deleted)
    db.commit()
    events_cleanup.append(soft_deleted.id)

    after = _detection_stats(admin_user)
    assert after["pending"] == before["pending"]
    assert after["pending_missing_source_media"] == before["pending_missing_source_media"]


def test_reject_rate_counts_soft_deleted_detection(admin_user, regular_user, events_cleanup, db):
    """A machine detection soft-deleted while ``detected`` counts as a reject: ``machine_total`` and ``machine_rejected`` both move."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    soft_deleted_detection = Event(
        owner_id=regular_user.id,
        title=f"Soft-deleted detection {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=now,
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
        deleted_at=now,
    )
    db.add(soft_deleted_detection)
    db.commit()
    events_cleanup.append(soft_deleted_detection.id)

    after = _detection_stats(admin_user)
    assert after["machine_total"] == before["machine_total"] + 1
    assert after["machine_rejected"] == before["machine_rejected"] + 1


def test_reject_rate_ignores_soft_deleted_geolocated(admin_user, regular_user, events_cleanup, db):
    """A soft-deleted ``geolocated`` machine row lifts ``machine_total`` but is not a reject."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    soft_deleted_geo = Event(
        owner_id=regular_user.id,
        title=f"Soft-deleted geo {uuid.uuid4().hex[:8]}",
        status=STATUS_GEOLOCATED,
        geolocated_at=now,
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
        deleted_at=now,
    )
    db.add(soft_deleted_geo)
    db.commit()
    events_cleanup.append(soft_deleted_geo.id)

    after = _detection_stats(admin_user)
    assert after["machine_total"] == before["machine_total"] + 1
    assert after["machine_rejected"] == before["machine_rejected"]


def test_pending_proof_video_counts_as_missing_proof_image(
    admin_user, regular_user, events_cleanup, db
):
    """A pending detection whose only proof media is a video still lacks a proof image (``pending_missing_proof_image``)."""
    before = _detection_stats(admin_user)

    now = datetime.now(UTC)
    video_proof = Event(
        owner_id=regular_user.id,
        title=f"Video proof {uuid.uuid4().hex[:8]}",
        status=STATUS_DETECTED,
        detected_at=now,
        source_url="https://example.com/source",
        detected_from_url=f"https://x.com/a/{uuid.uuid4().hex}",
    )
    db.add(video_proof)
    db.flush()
    db.add_all(
        [
            Media(
                event_id=video_proof.id,
                role="source",
                storage_url=f"http://localhost:8000/local-storage/x/{video_proof.id}/s.jpg",
                media_type="image",
            ),
            Media(
                event_id=video_proof.id,
                role="proof",
                storage_url=f"http://localhost:8000/local-storage/x/{video_proof.id}/p.mp4",
                media_type="video",
            ),
        ]
    )
    db.commit()
    events_cleanup.extend([video_proof.id])

    after = _detection_stats(admin_user)
    assert after["pending"] == before["pending"] + 1
    assert after["pending_missing_source_media"] == before["pending_missing_source_media"]
    assert after["pending_missing_source_url"] == before["pending_missing_source_url"]
    assert after["pending_missing_proof_image"] == before["pending_missing_proof_image"] + 1
