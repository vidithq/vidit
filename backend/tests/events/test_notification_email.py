"""Notification email: the queue row written with the notification, and the
worker's drain with its preference, address, cap and failure rules."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.config import settings
from app.models.notification import NOTIFICATION_KINDS, Notification, NotificationDelivery
from app.models.user import User
from app.models.user_preferences import UserPreferences
from app.services import email, notification_delivery, unsubscribe_tokens
from app.services.preferences import email_unsubscribe_token
from tests.conftest import login_as
from tests.events._helpers import client
from tests.events.test_requests import _geolocate_fulfilment, _kept, _make_request


@pytest.fixture
def outbox(monkeypatch) -> list[email.Email]:
    sent: list[email.Email] = []
    monkeypatch.setattr(email, "send", sent.append)
    return sent


def _email_off(db, user: User, kind: str) -> None:
    db.add(UserPreferences(user_id=user.id, notification_overrides={kind: False}))
    db.commit()


def _deliveries(db, user: User) -> list[NotificationDelivery]:
    db.expire_all()
    return (
        db.query(NotificationDelivery)
        .join(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(NotificationDelivery.created_at)
        .all()
    )


def _fulfil(db, requester: User, fulfiller: User, conflict):
    request = _make_request(db, author=requester)
    response = _geolocate_fulfilment(request.id, fulfiller, conflict, _kept(request))
    assert response.status_code == 200, response.text
    return request


def test_fulfilment_queues_and_the_drain_sends_one_branded_email(
    db, author, second_user, conflict, outbox
):
    request = _fulfil(db, author, second_user, conflict)
    # The action only queues: nothing is sent inside the request.
    assert outbox == []
    [row] = _deliveries(db, author)
    assert row.status == "queued"

    assert notification_delivery.drain(db) >= 1

    [message] = [m for m in outbox if m.to == author.email]
    assert second_user.username in message.subject
    assert f"/events/{request.id}" in message.text
    assert f"{settings.frontend_url}/settings" in message.text
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    one_click = message.headers["List-Unsubscribe"].strip("<>")
    assert one_click.startswith(f"{settings.api_url}/notifications/unsubscribe?token=")
    [row] = _deliveries(db, author)
    assert row.status == "done"
    assert row.sent_at is not None


def test_no_row_when_the_switch_is_off(db, author, second_user, conflict, outbox):
    _email_off(db, author, "request_fulfilled")
    _fulfil(db, author, second_user, conflict)
    assert _deliveries(db, author) == []


def test_default_off_kind_queues_only_for_an_analyst_who_turned_it_on(
    db, author, second_user, admin_user
):
    db.add(UserPreferences(user_id=second_user.id, notification_overrides={"new_follower": True}))
    db.commit()
    headers = login_as(client, admin_user)
    for followed in (author, second_user):
        response = client.post(f"/api/v1/users/{followed.username}/follow", headers=headers)
        assert response.status_code == 204, response.text

    assert _deliveries(db, author) == []
    assert [r.status for r in _deliveries(db, second_user)] == ["queued"]


def test_any_account_with_an_address_gets_a_row(db, author, second_user, conflict, outbox):
    _fulfil(db, author, second_user, conflict)
    assert [r.status for r in _deliveries(db, author)] == ["queued"]


def test_drain_skips_a_row_whose_switch_or_address_changed(
    db, author, second_user, conflict, outbox
):
    _fulfil(db, author, second_user, conflict)
    _email_off(db, author, "request_fulfilled")

    notification_delivery.drain(db)

    assert [m for m in outbox if m.to == author.email] == []
    assert [r.status for r in _deliveries(db, author)] == ["skipped"]


def test_drain_skips_a_row_whose_event_was_taken_down(db, author, second_user, conflict, outbox):
    request = _fulfil(db, author, second_user, conflict)
    db.refresh(request)
    request.hidden_at = datetime.now(UTC)
    db.commit()

    notification_delivery.drain(db)

    assert [r.status for r in _deliveries(db, author)] == ["skipped"]


def test_global_cap_holds_notification_email_but_not_auth_email(
    db, author, second_user, conflict, outbox, monkeypatch
):
    _fulfil(db, author, second_user, conflict)
    monkeypatch.setattr(settings, "notification_email_daily_cap", 0)

    assert notification_delivery.drain(db) == 0
    assert [r.status for r in _deliveries(db, author)] == ["queued"]

    # Auth email is sent inline and never counts against the cap.
    response = client.post("/api/v1/auth/forgot-password", json={"email": author.email})
    assert response.status_code == 204
    assert [m.subject for m in outbox if m.to == author.email] == ["Reset your Vidit password"]


def test_per_user_cap_holds_only_that_recipient(
    db, author, second_user, conflict, outbox, monkeypatch
):
    _fulfil(db, author, second_user, conflict)
    _fulfil(db, author, second_user, conflict)
    _fulfil(db, second_user, author, conflict)
    first = _deliveries(db, author)[0]
    first.status = "done"
    first.sent_at = datetime.now(UTC)
    db.commit()
    monkeypatch.setattr(settings, "notification_email_daily_cap_per_user", 1)

    notification_delivery.drain(db)

    assert [r.status for r in _deliveries(db, author)] == ["done", "queued"]
    assert [r.status for r in _deliveries(db, second_user)] == ["done"]


@pytest.mark.parametrize(
    ("status", "attempts", "counted"),
    [
        ("running", 0, True),
        ("failed", 0, True),
        ("failed", notification_delivery.MAX_ATTEMPTS, False),
    ],
)
def test_the_caps_count_rows_that_may_have_gone_out(
    db,
    author,
    second_user,
    conflict,
    outbox,
    monkeypatch,
    status,
    attempts,
    counted,
):
    _fulfil(db, author, second_user, conflict)
    _fulfil(db, author, second_user, conflict)
    first = _deliveries(db, author)[0]
    first.status = status
    first.attempt_count = attempts
    first.claimed_at = datetime.now(UTC) - timedelta(hours=2)
    db.commit()
    monkeypatch.setattr(settings, "notification_email_daily_cap", 1)

    notification_delivery.drain(db)

    assert _deliveries(db, author)[1].status == ("queued" if counted else "done")


def test_send_failure_never_breaks_the_action(db, author, second_user, conflict, monkeypatch):
    def _down(_message: email.Email) -> None:
        raise email.EmailRejectedError("provider down")

    monkeypatch.setattr(email, "send", _down)
    _fulfil(db, author, second_user, conflict)

    notification_delivery.drain(db)

    [row] = _deliveries(db, author)
    assert (row.status, row.attempt_count) == ("queued", 1)
    db.expire_all()
    assert db.query(Notification).filter(Notification.user_id == author.id).count() == 1


def test_refusals_retry_after_a_pause_then_fail(db, author, second_user, conflict, monkeypatch):
    def _refuse(_message: email.Email) -> None:
        raise email.EmailRejectedError("422")

    monkeypatch.setattr(email, "send", _refuse)
    _fulfil(db, author, second_user, conflict)

    for attempt in range(1, notification_delivery.MAX_ATTEMPTS + 1):
        notification_delivery.drain(db)
        [row] = _deliveries(db, author)
        assert row.attempt_count == attempt
        # A second pass inside the retry pause leaves the row alone.
        notification_delivery.drain(db)
        assert _deliveries(db, author)[0].attempt_count == attempt
        row.claimed_at = datetime.now(UTC) - notification_delivery.RETRY_AFTER
        db.commit()

    assert _deliveries(db, author)[0].status == "failed"


def test_unknown_outcome_stays_running_then_goes_stale(
    db, author, second_user, conflict, monkeypatch
):
    def _timeout(_message: email.Email) -> None:
        raise email.EmailSendError("timeout")

    monkeypatch.setattr(email, "send", _timeout)
    _fulfil(db, author, second_user, conflict)

    notification_delivery.drain(db)
    [row] = _deliveries(db, author)
    assert row.status == "running"

    row.claimed_at = (
        datetime.now(UTC) - notification_delivery.STALE_RUNNING_AFTER - timedelta(minutes=1)
    )
    db.commit()
    notification_delivery.drain(db)
    assert _deliveries(db, author)[0].status == "failed"


def test_a_row_queued_too_long_is_skipped(db, author, second_user, conflict, outbox, monkeypatch):
    _fulfil(db, author, second_user, conflict)
    [row] = _deliveries(db, author)
    row.created_at = (
        datetime.now(UTC) - notification_delivery.QUEUED_EXPIRES_AFTER - timedelta(minutes=1)
    )
    db.commit()

    notification_delivery.drain(db)

    assert _deliveries(db, author)[0].status == "skipped"
    assert [m for m in outbox if m.to == author.email] == []


def test_every_kind_that_can_email_has_copy():
    """A kind an analyst can switch on for email needs an email to send."""
    assert set(NOTIFICATION_KINDS) - set(notification_delivery._COPY) == set()


def _two_queued_rows(db, author, second_user, admin_user, conflict) -> None:
    """A request_fulfilled row for ``author``, then a new_follower row for ``second_user``."""
    _fulfil(db, author, second_user, conflict)
    db.add(UserPreferences(user_id=second_user.id, notification_overrides={"new_follower": True}))
    db.commit()
    headers = login_as(client, admin_user)
    response = client.post(f"/api/v1/users/{second_user.username}/follow", headers=headers)
    assert response.status_code == 204, response.text


def test_a_kind_without_copy_is_skipped_and_the_drain_goes_on(
    db, author, second_user, admin_user, conflict, outbox, monkeypatch
):
    _two_queued_rows(db, author, second_user, admin_user, conflict)
    copy = dict(notification_delivery._COPY)
    del copy["request_fulfilled"]
    monkeypatch.setattr(notification_delivery, "_COPY", copy)

    notification_delivery.drain(db)

    assert [r.status for r in _deliveries(db, author)] == ["skipped"]
    assert [r.status for r in _deliveries(db, second_user)] == ["done"]
    assert [m.to for m in outbox] == [second_user.email]


def test_a_row_that_raises_is_retried_and_the_drain_goes_on(
    db, author, second_user, admin_user, conflict, outbox, monkeypatch
):
    _two_queued_rows(db, author, second_user, admin_user, conflict)

    def _broken(_n: Notification) -> notification_delivery._Copy:
        raise RuntimeError("copy bug")

    monkeypatch.setattr(
        notification_delivery,
        "_COPY",
        {**notification_delivery._COPY, "request_fulfilled": _broken},
    )

    notification_delivery.drain(db)

    [row] = _deliveries(db, author)
    assert (row.status, row.attempt_count) == ("queued", 1)
    assert [r.status for r in _deliveries(db, second_user)] == ["done"]


@pytest.mark.parametrize("outcome", ["sent", "unknown"])
def test_a_failed_write_after_a_send_never_requeues_the_row(
    db, author, second_user, conflict, monkeypatch, outcome
):
    _fulfil(db, author, second_user, conflict)
    row = notification_delivery._claim_next(db, now=datetime.now(UTC))
    assert row is not None

    def land_fails(_row, _outcome):
        raise RuntimeError("database went away")

    monkeypatch.setattr(notification_delivery, "_land", land_fails)
    notification_delivery.deliver(db, row, lambda: outcome, what="notification email")

    [stored] = _deliveries(db, author)
    assert (stored.status, stored.attempt_count) == ("running", 0)


def test_the_one_click_unsubscribe_turns_off_that_kind_by_email_only(
    db, author, second_user, conflict, outbox
):
    _fulfil(db, author, second_user, conflict)
    notification_delivery.drain(db)
    [message] = [m for m in outbox if m.to == author.email]
    token = message.headers["List-Unsubscribe"].split("token=")[1].rstrip(">")

    client.cookies.clear()
    path = "/api/v1/notifications/unsubscribe"
    assert client.post(path, params={"token": token}).status_code == 204
    assert client.post(path, params={"token": token}).status_code == 204

    db.expire_all()
    prefs = db.get(UserPreferences, author.id)
    assert prefs.notification_overrides == {"request_fulfilled": False}

    forged = token.replace("request_fulfilled", "new_follower")
    refused = client.post(path, params={"token": forged})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (
        400,
        "invalid_unsubscribe_token",
    )
    other_purpose = unsubscribe_tokens.sign(b"vidit:other:", author.id, "request_fulfilled")
    assert client.post(path, params={"token": other_purpose}).status_code == 400


def test_opening_the_unsubscribe_url_confirms_first_and_changes_nothing(db, author):
    token = email_unsubscribe_token(author.id, "request_fulfilled")
    client.cookies.clear()
    response = client.get(
        "/api/v1/notifications/unsubscribe", params={"token": token}, follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"].startswith(
        f"{settings.frontend_url}/unsubscribe/notifications?token="
    )
    db.expire_all()
    assert db.get(UserPreferences, author.id) is None
