"""``GET`` and ``PATCH /users/me/preferences``: defaults without a row, the
allowlists, and overrides-only storage."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.notification import NOTIFICATION_KINDS
from app.models.user import User
from app.models.user_preferences import UserPreferences
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)
_PATH = "/api/v1/users/me/preferences"

_DEFAULT_DISPLAY = {"palette": "orange", "theme": "dark", "help_tooltips": True}
_NOTHING_STORED = {"palette": None, "theme": None, "help_tooltips": None}


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def user(db):
    client.cookies.clear()
    row = User(
        username=f"pref{uuid.uuid4().hex[:8]}",
        email=f"pref-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(row)
    db.commit()
    yield row
    client.cookies.clear()
    db.query(User).filter(User.id == row.id).delete(synchronize_session=False)
    db.commit()


def _stored(db, user: User) -> UserPreferences | None:
    db.expire_all()
    return db.get(UserPreferences, user.id)


def test_get_without_a_row_returns_the_defaults(db, user):
    login_as(client, user)
    response = client.get(_PATH)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display"] == _DEFAULT_DISPLAY
    assert body["display_defaults"] == _DEFAULT_DISPLAY
    assert body["display_stored"] == _NOTHING_STORED
    assert body["notifications"] == [
        {"kind": kind, "channels": defaults, "defaults": defaults}
        for kind, defaults in NOTIFICATION_KINDS.items()
    ]
    assert _stored(db, user) is None


def test_patch_creates_the_row_and_stores_only_overrides(db, user):
    headers = login_as(client, user)
    response = client.patch(
        _PATH,
        headers=headers,
        json={
            "notifications": {
                "request_fulfilled": {"email": False},
                "new_follower": {"email": False, "push": True},
            },
            "display": {"theme": "light"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display"] == {**_DEFAULT_DISPLAY, "theme": "light"}
    assert body["display_stored"] == {**_NOTHING_STORED, "theme": "light"}
    assert body["notifications"][0]["channels"] == {"email": False, "push": True}
    assert body["notifications"][1]["channels"] == {"email": False, "push": True}

    row = _stored(db, user)
    assert row is not None
    assert row.notification_overrides == {
        "request_fulfilled": {"email": False},
        "new_follower": {"push": True},
    }
    assert row.display == {"theme": "light"}

    # Back to the default drops the override; an omitted display field stays.
    response = client.patch(
        _PATH,
        headers=headers,
        json={
            "notifications": {
                "request_fulfilled": {"email": True},
                "new_follower": {"push": False},
            }
        },
    )
    assert response.status_code == 200
    row = _stored(db, user)
    assert row.notification_overrides == {}
    assert row.display == {"theme": "light"}


def test_patch_null_clears_a_display_value(db, user):
    headers = login_as(client, user)
    client.patch(_PATH, headers=headers, json={"display": {"palette": "rose", "theme": "light"}})
    response = client.patch(_PATH, headers=headers, json={"display": {"palette": None}})
    assert response.json()["display"] == {**_DEFAULT_DISPLAY, "theme": "light"}
    assert _stored(db, user).display == {"theme": "light"}


@pytest.mark.parametrize(
    "body",
    [
        {"notifications": {"co_geolocator_invite": {"email": True}}},
        {"notifications": {"request_fulfilled": {"sms": True}}},
        {"notifications": {"request_fulfilled": {"email": "yes please"}}},
        {"display": {"palette": "chartreuse"}},
        {"display": {"theme": "sepia"}},
        {"display": {"font": "serif"}},
        {"marketing_emails": True},
    ],
)
def test_patch_rejects_values_outside_the_allowlists(db, user, body):
    headers = login_as(client, user)
    response = client.patch(_PATH, headers=headers, json=body)
    assert response.status_code == 422, response.text
    assert _stored(db, user) is None


def test_stale_stored_values_read_as_defaults(db, user):
    db.add(
        UserPreferences(
            user_id=user.id,
            notification_overrides={"retired_kind": {"email": True}, "new_follower": {"x": 1}},
            display={"palette": "chartreuse", "theme": "light", "font": "serif"},
        )
    )
    db.commit()
    login_as(client, user)
    body = client.get(_PATH).json()
    assert body["display"] == {**_DEFAULT_DISPLAY, "theme": "light"}
    assert body["display_stored"] == {**_NOTHING_STORED, "theme": "light"}
    assert [n["kind"] for n in body["notifications"]] == list(NOTIFICATION_KINDS)
    assert body["notifications"][1]["channels"] == {"email": False, "push": False}


def test_preferences_require_a_session():
    client.cookies.clear()
    assert client.get(_PATH).status_code == 401
