"""Web Push: device registration and its authz, the push row queued with the
notification, and the drain's fan-out, 404/410 cleanup and failure rules."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
import requests
from py_vapid import Vapid
from py_vapid.utils import b64urlencode
from pywebpush import WebPushException

from app.config import settings
from app.models.auth_token import PURPOSE_PASSWORD_RESET
from app.models.notification import NOTIFICATION_KINDS, Notification, NotificationDelivery
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.models.user_preferences import UserPreferences
from app.services import auth_tokens, email, notification_delivery, push
from tests.conftest import login_as
from tests.events._helpers import client
from tests.events.test_requests import _geolocate_fulfilment, _make_request

_SUBSCRIPTIONS = "/api/v1/users/me/push-subscriptions"
_CONFIG = "/api/v1/users/me/push-config"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _subscription(endpoint: str | None = None) -> dict:
    return {
        "endpoint": endpoint or f"https://fcm.googleapis.com/fcm/send/{uuid.uuid4().hex}",
        "expirationTime": None,
        "keys": {"p256dh": _b64(b"\x04" + b"\x01" * 64), "auth": _b64(b"\x02" * 16)},
    }


def _private_key() -> str:
    vapid = Vapid()
    vapid.generate_keys()
    return b64urlencode(vapid.private_key.private_numbers().private_value.to_bytes(32, "big"))


@pytest.fixture
def vapid(monkeypatch) -> None:
    monkeypatch.setattr(settings, "vapid_private_key", _private_key())
    monkeypatch.setattr(settings, "vapid_subject", "mailto:push@example.com")


class _PushServices:
    """Stands in for ``pywebpush.webpush``: records each push and answers per
    endpoint with an HTTP status or an exception."""

    def __init__(self) -> None:
        self.pushed: list[tuple[str, dict]] = []
        self.answers: dict[str, int | Exception] = {}

    def __call__(self, *, subscription_info, data, vapid_claims, **_kw):
        endpoint = subscription_info["endpoint"]
        assert vapid_claims["sub"] == settings.vapid_subject
        answer = self.answers.get(endpoint, 201)
        if isinstance(answer, Exception):
            raise answer
        if answer > 202:
            raise WebPushException(
                "Push failed", response=SimpleNamespace(status_code=answer, text=endpoint)
            )
        self.pushed.append((endpoint, json.loads(data)))


@pytest.fixture
def services(monkeypatch) -> _PushServices:
    fake = _PushServices()
    monkeypatch.setattr(push, "webpush", fake)
    return fake


@pytest.fixture(autouse=True)
def _no_email(monkeypatch) -> None:
    monkeypatch.setattr(email, "send", lambda _message: None)


def _register(user: User, body: dict | None = None):
    headers = login_as(client, user)
    return client.post(
        _SUBSCRIPTIONS,
        json=body or _subscription(),
        headers={**headers, "User-Agent": "Mozilla/5.0 (Test)"},
    )


def _devices(db, user: User) -> list[PushSubscription]:
    db.expire_all()
    return db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()


def _push_rows(db, user: User) -> list[NotificationDelivery]:
    db.expire_all()
    return (
        db.query(NotificationDelivery)
        .join(Notification)
        .filter(Notification.user_id == user.id, NotificationDelivery.channel == "push")
        .order_by(NotificationDelivery.created_at)
        .all()
    )


def _fulfil(db, requester: User, fulfiller: User, conflict, tag):
    request = _make_request(db, author=requester)
    response = _geolocate_fulfilment(client, request.id, fulfiller, conflict, tag)
    assert response.status_code == 200, response.text
    return request


# Registration


def test_register_stores_the_device_and_never_returns_the_endpoint(db, author):
    body = _subscription()
    response = _register(author, body)
    assert response.status_code == 201, response.text
    payload = response.json()
    assert set(payload) == {"id", "user_agent", "created_at", "last_success_at"}
    assert body["endpoint"] not in response.text

    [device] = _devices(db, author)
    assert (str(device.id), device.endpoint) == (payload["id"], body["endpoint"])
    assert device.user_agent == "Mozilla/5.0 (Test)"


def test_registering_again_refreshes_one_row_and_moves_it_across_accounts(db, author, second_user):
    body = _subscription()
    first = _register(author, body).json()
    again = _register(author, body).json()
    assert again["id"] == first["id"]
    assert len(_devices(db, author)) == 1

    moved = _register(second_user, body)
    assert moved.status_code == 201
    assert _devices(db, author) == []
    assert [str(d.id) for d in _devices(db, second_user)] == [first["id"]]


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://internal.example.com/push",
        "http://fcm.googleapis.com/fcm/send/x",
        "https://fcm.googleapis.com:8443/fcm/send/x",
        "https://user@fcm.googleapis.com/fcm/send/x",
        "https://fcm.googleapis.com.evil.example/x",
    ],
)
def test_register_refuses_an_endpoint_off_the_push_services(db, author, endpoint):
    response = _register(author, _subscription(endpoint))
    assert response.status_code == 422, response.text
    assert _devices(db, author) == []


def test_register_accepts_each_browser_push_service(db, author):
    for endpoint in (
        "https://updates.push.services.mozilla.com/wpush/v2/x",
        "https://web.push.apple.com/x",
        "https://wns2-db5p.notify.windows.com/w/?token=x",
    ):
        assert _register(author, _subscription(endpoint)).status_code == 201
    assert len(_devices(db, author)) == 3


@pytest.mark.parametrize(
    "keys",
    [
        {"p256dh": _b64(b"\x04" + b"\x01" * 10), "auth": _b64(b"\x02" * 16)},
        {"p256dh": _b64(b"\x02" + b"\x01" * 64), "auth": _b64(b"\x02" * 16)},
        {"p256dh": _b64(b"\x04" + b"\x01" * 64), "auth": _b64(b"\x02" * 8)},
        {"p256dh": "not base64!", "auth": _b64(b"\x02" * 16)},
    ],
)
def test_register_refuses_malformed_keys(db, author, keys):
    response = _register(author, {**_subscription(), "keys": keys})
    assert response.status_code == 422, response.text


def test_delete_drops_only_your_own_device(db, author, second_user):
    device_id = _register(author).json()["id"]

    headers = login_as(client, second_user)
    response = client.delete(f"{_SUBSCRIPTIONS}/{device_id}", headers=headers)
    assert response.status_code == 404
    assert len(_devices(db, author)) == 1

    headers = login_as(client, author)
    response = client.delete(f"{_SUBSCRIPTIONS}/{device_id}", headers=headers)
    assert response.status_code == 204
    assert _devices(db, author) == []


def test_list_shows_only_your_devices_newest_first_without_endpoints(db, author, second_user):
    older = _subscription()
    older_id = _register(author, older).json()["id"]
    newer_id = _register(author).json()["id"]
    _register(second_user)

    response = client.get(_SUBSCRIPTIONS, headers=login_as(client, author))
    assert response.status_code == 200, response.text
    assert [d["id"] for d in response.json()] == [newer_id, older_id]
    assert older["endpoint"] not in response.text


def test_a_password_change_forgets_every_device(db, author, second_user):
    _register(author)
    _register(author)
    _register(second_user)
    response = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "password123", "new_password": "newpassword456"},
        headers=login_as(client, author),
    )
    assert response.status_code == 204, response.text
    assert _devices(db, author) == []
    assert len(_devices(db, second_user)) == 1


def test_a_password_reset_forgets_every_device(db, author):
    _register(author)
    raw = auth_tokens.mint(db, user_id=author.id, purpose=PURPOSE_PASSWORD_RESET, ttl_minutes=15)
    db.commit()
    client.cookies.clear()
    response = client.post(
        "/api/v1/auth/reset-password", json={"token": raw, "new_password": "newpassword456"}
    )
    assert response.status_code == 204, response.text
    assert _devices(db, author) == []


def test_push_routes_require_a_session():
    client.cookies.clear()
    assert client.get(_CONFIG).status_code == 401
    assert client.post(_SUBSCRIPTIONS, json=_subscription()).status_code in (401, 403)


def test_config_carries_the_derived_public_key_only_when_push_is_on(author, monkeypatch):
    login_as(client, author)
    assert client.get(_CONFIG).json() == {"public_key": None}

    key = _private_key()
    monkeypatch.setattr(settings, "vapid_private_key", key)
    monkeypatch.setattr(settings, "vapid_subject", "mailto:push@example.com")
    public_key = client.get(_CONFIG).json()["public_key"]
    raw = base64.urlsafe_b64decode(public_key + "=" * (-len(public_key) % 4))
    assert len(raw) == 65 and raw[0] == 0x04
    assert public_key == push.public_key()


# Queueing


def test_fulfilment_queues_a_push_row_only_for_an_analyst_with_a_device(
    db, author, second_user, conflict, capture_source_tag
):
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    assert _push_rows(db, author) == []

    _register(author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    [row] = _push_rows(db, author)
    assert row.status == "queued"


def test_push_switch_off_queues_no_push_row(db, author, second_user, conflict, capture_source_tag):
    _register(author)
    db.add(
        UserPreferences(
            user_id=author.id, notification_overrides={"request_fulfilled": {"push": False}}
        )
    )
    db.commit()
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    assert _push_rows(db, author) == []


def test_default_off_kind_pushes_only_once_turned_on(db, author, second_user, admin_user):
    _register(author)
    _register(second_user)
    db.add(
        UserPreferences(
            user_id=second_user.id, notification_overrides={"new_follower": {"push": True}}
        )
    )
    db.commit()
    headers = login_as(client, admin_user)
    for followed in (author, second_user):
        response = client.post(f"/api/v1/users/{followed.username}/follow", headers=headers)
        assert response.status_code == 204, response.text

    assert _push_rows(db, author) == []
    assert [r.status for r in _push_rows(db, second_user)] == ["queued"]


# Drain


def test_drain_pushes_to_every_device_with_the_payload(
    db, author, second_user, conflict, capture_source_tag, vapid, services
):
    phone, laptop = _subscription(), _subscription()
    _register(author, phone)
    _register(author, laptop)
    request = _fulfil(db, author, second_user, conflict, capture_source_tag)
    assert services.pushed == []

    notification_delivery.drain(db)

    mine = [(e, p) for e, p in services.pushed if e in (phone["endpoint"], laptop["endpoint"])]
    assert sorted(e for e, _ in mine) == sorted([phone["endpoint"], laptop["endpoint"]])
    payload = mine[0][1]
    assert payload == {
        "title": f"{second_user.username} geolocated your request",
        "body": request.title,
        "path": f"/events/{request.id}",
    }
    [row] = _push_rows(db, author)
    assert (row.status, row.sent_at is not None) == ("sent", True)
    assert all(d.last_success_at is not None for d in _devices(db, author))


def test_gone_device_is_deleted_and_the_rest_still_receive(
    db, author, second_user, conflict, capture_source_tag, vapid, services
):
    stale, live = _subscription(), _subscription()
    _register(author, stale)
    _register(author, live)
    services.answers[stale["endpoint"]] = 410
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)

    assert [d.endpoint for d in _devices(db, author)] == [live["endpoint"]]
    assert [r.status for r in _push_rows(db, author)] == ["sent"]


def test_every_device_gone_skips_the_row(
    db, author, second_user, conflict, capture_source_tag, vapid, services
):
    body = _subscription()
    _register(author, body)
    services.answers[body["endpoint"]] = 404
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)

    assert _devices(db, author) == []
    assert [r.status for r in _push_rows(db, author)] == ["skipped"]


def test_refusal_is_retried_and_logs_no_endpoint(
    db, author, second_user, conflict, capture_source_tag, vapid, services, caplog
):
    body = _subscription()
    _register(author, body)
    services.answers[body["endpoint"]] = 503
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)

    [row] = _push_rows(db, author)
    assert (row.status, row.attempts) == ("queued", 1)
    assert len(_devices(db, author)) == 1
    assert "503" in caplog.text
    assert body["endpoint"] not in caplog.text


def test_three_refusals_in_a_row_drop_the_device_and_a_success_resets_the_count(
    db, author, vapid, services
):
    flaky, broken = _subscription(), _subscription()
    _register(author, flaky)
    _register(author, broken)
    services.answers[flaky["endpoint"]] = 503
    services.answers[broken["endpoint"]] = 503
    message = push.PushMessage(title="t", body="b", path="/")

    for _ in range(2):
        push.send(db, user_id=author.id, message=message)
        db.commit()
    services.answers.pop(flaky["endpoint"])
    push.send(db, user_id=author.id, message=message)
    db.commit()
    services.answers[flaky["endpoint"]] = 503
    push.send(db, user_id=author.id, message=message)
    db.commit()

    assert [d.endpoint for d in _devices(db, author)] == [flaky["endpoint"]]


def test_registering_past_the_device_cap_drops_the_oldest(db, author, monkeypatch):
    monkeypatch.setattr(push, "MAX_DEVICES_PER_USER", 2)
    _register(author)
    middle = _register(author).json()["id"]
    newest = _register(author).json()["id"]

    assert {str(d.id) for d in _devices(db, author)} == {middle, newest}


def test_transport_error_leaves_the_row_sending(
    db, author, second_user, conflict, capture_source_tag, vapid, services, caplog
):
    body = _subscription()
    _register(author, body)
    services.answers[body["endpoint"]] = requests.ConnectionError(body["endpoint"])
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)

    assert [r.status for r in _push_rows(db, author)] == ["sending"]
    assert body["endpoint"] not in caplog.text


def test_drain_skips_while_push_is_unconfigured(
    db, author, second_user, conflict, capture_source_tag, services
):
    _register(author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)

    assert [r.status for r in _push_rows(db, author)] == ["skipped"]
    assert services.pushed == []


def test_drain_skips_a_row_whose_switch_went_off(
    db, author, second_user, conflict, capture_source_tag, vapid, services
):
    _register(author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    db.add(
        UserPreferences(
            user_id=author.id, notification_overrides={"request_fulfilled": {"push": False}}
        )
    )
    db.commit()

    notification_delivery.drain(db)

    assert [r.status for r in _push_rows(db, author)] == ["skipped"]
    assert services.pushed == []


def test_push_failure_never_breaks_the_action(
    db, author, second_user, conflict, capture_source_tag, vapid, monkeypatch
):
    def _down(**_kw):
        raise RuntimeError("push service down")

    monkeypatch.setattr(push, "webpush", _down)
    _register(author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)

    db.expire_all()
    assert db.query(Notification).filter(Notification.user_id == author.id).count() == 1
    assert [(r.status, r.attempts) for r in _push_rows(db, author)] == [("queued", 1)]


def test_sent_pushes_do_not_count_against_the_email_cap(
    db, author, second_user, conflict, capture_source_tag, vapid, services, monkeypatch
):
    outbox: list[email.Email] = []
    monkeypatch.setattr(email, "send", outbox.append)
    _register(author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    notification_delivery.drain(db)
    assert [r.status for r in _push_rows(db, author)] == ["sent"]

    sent_emails = (
        db.query(NotificationDelivery)
        .filter(NotificationDelivery.channel == "email", NotificationDelivery.status == "sent")
        .count()
    )
    monkeypatch.setattr(settings, "notification_email_daily_cap", sent_emails + 1)
    second_user.email_verified_at = datetime.now(UTC)
    db.commit()
    _fulfil(db, second_user, author, conflict, capture_source_tag)
    notification_delivery.drain(db)
    assert [m.to for m in outbox] == [second_user.email]


def test_every_kind_that_can_push_has_a_builder():
    """A kind an analyst can switch on for push needs a message to send."""
    pushable = {kind for kind, channels in NOTIFICATION_KINDS.items() if "push" in channels}
    assert pushable - set(notification_delivery._PUSH_BUILDERS) == set()


def test_a_kind_without_a_push_builder_is_skipped_and_the_drain_goes_on(
    db, author, second_user, admin_user, conflict, capture_source_tag, vapid, services, monkeypatch
):
    _register(author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    db.add(
        UserPreferences(user_id=author.id, notification_overrides={"new_follower": {"push": True}})
    )
    db.commit()
    headers = login_as(client, admin_user)
    response = client.post(f"/api/v1/users/{author.username}/follow", headers=headers)
    assert response.status_code == 204, response.text
    builders = dict(notification_delivery._PUSH_BUILDERS)
    del builders["request_fulfilled"]
    monkeypatch.setattr(notification_delivery, "_PUSH_BUILDERS", builders)

    notification_delivery.drain(db)

    assert [r.status for r in _push_rows(db, author)] == ["skipped", "sent"]
