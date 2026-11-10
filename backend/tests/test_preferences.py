"""``GET`` and ``PATCH /users/me/preferences``: defaults without a row, the
allowlists, and overrides-only storage."""

from __future__ import annotations

import pytest

from app.models.notification import NOTIFICATION_KINDS
from app.models.user import User
from app.models.user_preferences import UserPreferences
from tests._fixtures import client
from tests.conftest import login_as

_PATH = "/api/v1/users/me/preferences"

_DEFAULT_DISPLAY = {"palette": "orange", "theme": "dark", "help_tooltips": True}
_NOTHING_STORED = {"palette": None, "theme": None, "help_tooltips": None}


def _stored(db, regular_user: User) -> UserPreferences | None:
    db.expire_all()
    return db.get(UserPreferences, regular_user.id)


def test_get_without_a_row_returns_the_defaults(db, regular_user):
    login_as(client, regular_user)
    response = client.get(_PATH)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display"] == _DEFAULT_DISPLAY
    assert body["display_defaults"] == _DEFAULT_DISPLAY
    assert body["display_stored"] == _NOTHING_STORED
    assert body["notifications"] == [
        {"kind": kind, "email": default, "default": default}
        for kind, default in NOTIFICATION_KINDS.items()
    ]
    assert body["approval_request_audience"] == "following"
    assert _stored(db, regular_user) is None


def test_patch_creates_the_row_and_stores_only_overrides(db, regular_user):
    headers = login_as(client, regular_user)
    response = client.patch(
        _PATH,
        headers=headers,
        json={
            "notifications": {
                "request_fulfilled": False,
                "new_follower": False,
                "co_geolocator_removed": True,
            },
            "display": {"theme": "light"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display"] == {**_DEFAULT_DISPLAY, "theme": "light"}
    assert body["display_stored"] == {**_NOTHING_STORED, "theme": "light"}
    emailed = {n["kind"]: n["email"] for n in body["notifications"]}
    assert emailed["request_fulfilled"] is False
    assert emailed["new_follower"] is False
    assert emailed["co_geolocator_removed"] is True

    row = _stored(db, regular_user)
    assert row is not None
    assert row.notification_overrides == {
        "request_fulfilled": False,
        "co_geolocator_removed": True,
    }
    assert row.display == {"theme": "light"}

    # Back to the default drops the override; an omitted display field stays.
    response = client.patch(
        _PATH,
        headers=headers,
        json={
            "notifications": {
                "request_fulfilled": True,
                "co_geolocator_removed": False,
            }
        },
    )
    assert response.status_code == 200
    row = _stored(db, regular_user)
    assert row.notification_overrides == {}
    assert row.display == {"theme": "light"}


def test_patch_null_clears_a_display_value(db, regular_user):
    headers = login_as(client, regular_user)
    client.patch(_PATH, headers=headers, json={"display": {"palette": "rose", "theme": "light"}})
    response = client.patch(_PATH, headers=headers, json={"display": {"palette": None}})
    assert response.json()["display"] == {**_DEFAULT_DISPLAY, "theme": "light"}
    assert _stored(db, regular_user).display == {"theme": "light"}


@pytest.mark.parametrize(
    "body",
    [
        {"notifications": {"not_a_kind": True}},
        {"notifications": {"request_fulfilled": {"email": True}}},
        {"notifications": {"request_fulfilled": "yes please"}},
        {"display": {"palette": "chartreuse"}},
        {"display": {"theme": "sepia"}},
        {"display": {"font": "serif"}},
        {"marketing_emails": True},
    ],
)
def test_patch_rejects_values_outside_the_allowlists(db, regular_user, body):
    headers = login_as(client, regular_user)
    response = client.patch(_PATH, headers=headers, json=body)
    assert response.status_code == 422, response.text
    assert _stored(db, regular_user) is None


def test_stale_stored_values_read_as_defaults(db, regular_user):
    db.add(
        UserPreferences(
            user_id=regular_user.id,
            notification_overrides={"retired_kind": True, "new_follower": {"email": True}},
            display={"palette": "chartreuse", "theme": "light", "font": "serif"},
        )
    )
    db.commit()
    login_as(client, regular_user)
    body = client.get(_PATH).json()
    assert body["display"] == {**_DEFAULT_DISPLAY, "theme": "light"}
    assert body["display_stored"] == {**_NOTHING_STORED, "theme": "light"}
    assert [n["kind"] for n in body["notifications"]] == list(NOTIFICATION_KINDS)
    assert body["notifications"][1]["email"] is False


def test_preferences_require_a_session():
    client.cookies.clear()
    assert client.get(_PATH).status_code == 401
