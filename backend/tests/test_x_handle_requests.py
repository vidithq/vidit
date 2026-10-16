"""X handle change requests: the analyst files one, an admin approves it
through the X handle write path or declines it with a reason, and the
analyst is notified either way."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.notification import Notification, NotificationDelivery
from app.models.user import User
from app.models.x_handle_request import XHandleRequest
from app.services.auth import hash_password
from app.services.auth_cookies import CSRF_HEADER
from tests.conftest import TEST_CSRF_TOKEN, login_as

# Every mutating call echoes the CSRF token ``login_as`` sets as a cookie.
client = TestClient(app, headers={CSRF_HEADER: TEST_CSRF_TOKEN})

_MINE = "/api/v1/users/me/x-handle"
_REQUEST = "/api/v1/users/me/x-handle-request"
_QUEUE = "/api/v1/admin/x-handle-requests"


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


def _make_user(db, prefix: str, **kw) -> User:
    user = User(
        username=f"{prefix}{uuid.uuid4().hex[:8]}",
        email=f"{prefix}-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        **kw,
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def make_user(db):
    ids: list[uuid.UUID] = []

    def factory(prefix: str = "xh", **kw) -> User:
        user = _make_user(db, prefix, **kw)
        ids.append(user.id)
        return user

    yield factory
    db.expire_all()
    db.query(AdminEvent).filter(AdminEvent.actor_id.in_(ids)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def analyst(make_user):
    return make_user("xha")


@pytest.fixture
def admin(make_user):
    return make_user("xhadm", is_admin=True)


def _handle() -> str:
    return f"h{uuid.uuid4().hex[:12]}"


def _submit(user: User, x_handle: str, reason: str | None = None):
    login_as(client, user)
    body: dict[str, str | None] = {"x_handle": x_handle}
    if reason is not None:
        body["reason"] = reason
    return client.put(_REQUEST, json=body)


def _row(db, user: User) -> XHandleRequest | None:
    db.expire_all()
    return db.query(XHandleRequest).filter(XHandleRequest.user_id == user.id).one_or_none()


def _kinds(db, user: User) -> list[str]:
    db.expire_all()
    return [n.kind for n in db.query(Notification).filter(Notification.user_id == user.id)]


def test_read_without_handle_or_request(analyst):
    login_as(client, analyst)
    response = client.get(_MINE)
    assert response.status_code == 200, response.text
    assert response.json() == {"x_handle": None, "request": None}


def test_read_shows_the_bound_handle(db, analyst):
    analyst.x_handle = _handle()
    db.commit()
    login_as(client, analyst)
    assert client.get(_MINE).json()["x_handle"] == analyst.x_handle


def test_submit_normalizes_and_stores_a_pending_request(db, analyst):
    handle = _handle()
    response = _submit(analyst, f"@{handle.upper()}", reason="  I renamed my account  ")
    assert response.status_code == 200, response.text
    request = response.json()["request"]
    assert request["x_handle"] == handle
    assert request["reason"] == "I renamed my account"
    assert request["status"] == "pending"
    assert request["decline_reason"] is None
    assert client.get(_MINE).json()["request"] == request


def test_a_second_submit_replaces_the_first(db, analyst):
    first = _submit(analyst, _handle()).json()["request"]
    second_handle = _handle()
    second = _submit(analyst, second_handle).json()["request"]
    assert second["id"] != first["id"]
    db.expire_all()
    rows = db.query(XHandleRequest).filter(XHandleRequest.user_id == analyst.id).all()
    assert [(r.id, r.x_handle) for r in rows] == [(uuid.UUID(second["id"]), second_handle)]


def test_submit_replaces_a_declined_request(db, analyst):
    _submit(analyst, _handle())
    row = _row(db, analyst)
    assert row is not None
    row.status, row.decline_reason, row.decided_at = "declined", "no", datetime.now(UTC)
    db.commit()
    request = _submit(analyst, _handle()).json()["request"]
    assert request["status"] == "pending"
    assert request["decline_reason"] is None


def test_submit_refuses_the_handle_already_bound(db, analyst):
    analyst.x_handle = _handle()
    db.commit()
    response = _submit(analyst, analyst.x_handle)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "x_handle_unchanged"
    assert _row(db, analyst) is None


@pytest.mark.parametrize(
    "body",
    [{"x_handle": "not a handle!"}, {"x_handle": "ok_handle", "reason": "x" * 501}, {}],
)
def test_submit_validates_the_body(analyst, body):
    login_as(client, analyst)
    assert client.put(_REQUEST, json=body).status_code == 422


def test_self_routes_require_a_session():
    assert client.get(_MINE).status_code == 401
    assert client.put(_REQUEST, json={"x_handle": "anyone"}).status_code == 401


def test_a_request_only_ever_names_its_author(db, make_user):
    alice, bob = make_user(), make_user()
    _submit(alice, _handle())
    bob_handle = _handle()
    _submit(bob, bob_handle)
    alice_row, bob_row = _row(db, alice), _row(db, bob)
    assert alice_row is not None and bob_row is not None
    assert bob_row.x_handle == bob_handle
    assert alice_row.x_handle != bob_handle
    login_as(client, alice)
    assert client.get(_MINE).json()["request"]["id"] == str(alice_row.id)


def test_admin_routes_refuse_a_non_admin(db, analyst):
    _submit(analyst, _handle())
    row = _row(db, analyst)
    assert row is not None
    login_as(client, analyst)
    assert client.get(_QUEUE).status_code == 403
    assert client.post(f"{_QUEUE}/{row.id}/approve").status_code == 403
    assert client.post(f"{_QUEUE}/{row.id}/decline", json={"reason": "no"}).status_code == 403
    assert _row(db, analyst) is not None


def test_queue_lists_pending_requests_on_live_accounts(db, make_user, admin):
    pending, declined, gone = make_user(), make_user(), make_user()
    pending.x_handle = _handle()
    db.commit()
    for user in (pending, declined, gone):
        _submit(user, _handle())
    declined_row = _row(db, declined)
    assert declined_row is not None
    declined_row.status = "declined"
    declined_row.decline_reason = "no"
    declined_row.decided_at = datetime.now(UTC)
    gone.deleted_at = datetime.now(UTC)
    db.commit()

    login_as(client, admin)
    response = client.get(_QUEUE)
    assert response.status_code == 200, response.text
    mine = [
        r
        for r in response.json()
        if r["user"]["id"] in {str(u.id) for u in (pending, declined, gone)}
    ]
    assert len(mine) == 1
    assert mine[0]["user"]["x_handle"] == pending.x_handle
    assert mine[0]["x_handle"] == _row(db, pending).x_handle


def test_approve_binds_the_handle_and_notifies(db, analyst, admin):
    handle = _handle()
    request_id = _submit(analyst, handle).json()["request"]["id"]
    login_as(client, admin)
    response = client.post(f"{_QUEUE}/{request_id}/approve")
    assert response.status_code == 200, response.text
    assert response.json()["x_handle"] == handle

    db.expire_all()
    assert db.get(User, analyst.id).x_handle == handle
    assert _row(db, analyst) is None
    assert _kinds(db, analyst) == ["x_handle_request_approved"]
    audit = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin.id, AdminEvent.action == "x_handle_linked")
        .one()
    )
    assert audit.target == {"user_id": str(analyst.id), "x_handle": handle}


def test_approve_goes_through_the_conflict_check(db, make_user, admin):
    analyst, holder = make_user(), make_user()
    handle = _handle()
    request_id = _submit(analyst, handle).json()["request"]["id"]
    holder.x_handle = handle
    db.commit()

    login_as(client, admin)
    response = client.post(f"{_QUEUE}/{request_id}/approve")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "x_handle_conflict"

    db.expire_all()
    assert db.get(User, analyst.id).x_handle is None
    row = _row(db, analyst)
    assert row is not None and row.status == "pending"
    assert _kinds(db, analyst) == []


def test_approve_refuses_a_replaced_request(db, analyst, admin):
    stale = _submit(analyst, _handle()).json()["request"]["id"]
    _submit(analyst, _handle())
    login_as(client, admin)
    response = client.post(f"{_QUEUE}/{stale}/approve")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "x_handle_request_not_found"


@pytest.mark.parametrize("body", [{}, {"reason": ""}, {"reason": "   "}])
def test_decline_requires_a_reason(db, analyst, admin, body):
    request_id = _submit(analyst, _handle()).json()["request"]["id"]
    login_as(client, admin)
    assert client.post(f"{_QUEUE}/{request_id}/decline", json=body).status_code == 422
    row = _row(db, analyst)
    assert row is not None and row.status == "pending"


def test_decline_keeps_the_reason_for_the_requester_and_notifies(db, analyst, admin):
    handle = _handle()
    request_id = _submit(analyst, handle).json()["request"]["id"]
    login_as(client, admin)
    response = client.post(
        f"{_QUEUE}/{request_id}/decline", json={"reason": " Post from the new handle first "}
    )
    assert response.status_code == 204, response.text

    db.expire_all()
    assert db.get(User, analyst.id).x_handle is None
    assert _kinds(db, analyst) == ["x_handle_request_declined"]
    audit = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin.id, AdminEvent.action == "x_handle_request_declined")
        .one()
    )
    assert audit.target == {
        "user_id": str(analyst.id),
        "x_handle": handle,
        "reason": "Post from the new handle first",
    }

    login_as(client, analyst)
    request = client.get(_MINE).json()["request"]
    assert request["status"] == "declined"
    assert request["decline_reason"] == "Post from the new handle first"
    assert request["decided_at"] is not None

    login_as(client, admin)
    again = client.post(f"{_QUEUE}/{request_id}/decline", json={"reason": "twice"})
    assert again.status_code == 404


def test_outcome_notifications_reach_the_feed_without_an_actor(analyst, admin):
    request_id = _submit(analyst, _handle()).json()["request"]["id"]
    login_as(client, admin)
    client.post(f"{_QUEUE}/{request_id}/decline", json={"reason": "no"})
    request_id = _submit(analyst, _handle()).json()["request"]["id"]
    login_as(client, admin)
    client.post(f"{_QUEUE}/{request_id}/approve")

    login_as(client, analyst)
    feed = client.get("/api/v1/notifications").json()
    assert [(n["kind"], n["actor"], n["event"]) for n in feed] == [
        ("x_handle_request_approved", None, None),
        ("x_handle_request_declined", None, None),
    ]


def test_a_decision_queues_an_email_to_a_verified_address(db, analyst, admin):
    analyst.email_verified_at = datetime.now(UTC)
    db.commit()
    request_id = _submit(analyst, _handle()).json()["request"]["id"]
    login_as(client, admin)
    client.post(f"{_QUEUE}/{request_id}/decline", json={"reason": "no"})

    db.expire_all()
    channels = [
        d.channel
        for d in db.query(NotificationDelivery)
        .join(Notification, NotificationDelivery.notification_id == Notification.id)
        .filter(Notification.user_id == analyst.id)
    ]
    assert channels == ["email"]
