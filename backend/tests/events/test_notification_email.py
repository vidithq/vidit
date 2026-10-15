"""Notification email: the queue row written with the notification, and the
worker's drain with its preference, address, cap and failure rules."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.config import settings
from app.models.notification import Notification, NotificationDelivery
from app.models.user import User
from app.models.user_preferences import UserPreferences
from app.services import email, notification_delivery
from tests.conftest import login_as
from tests.events._helpers import client
from tests.events.test_requests import _geolocate_fulfilment, _make_request


@pytest.fixture
def outbox(monkeypatch) -> list[email.Email]:
    sent: list[email.Email] = []
    monkeypatch.setattr(email, "send", sent.append)
    return sent


def _verify(db, *users: User) -> None:
    for user in users:
        user.email_verified_at = datetime.now(UTC)
    db.commit()


def _email_off(db, user: User, kind: str) -> None:
    db.add(UserPreferences(user_id=user.id, notification_overrides={kind: {"email": False}}))
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


def _fulfil(db, requester: User, fulfiller: User, conflict, tag):
    request = _make_request(db, author=requester)
    response = _geolocate_fulfilment(client, request.id, fulfiller, conflict, tag)
    assert response.status_code == 200, response.text
    return request


def test_fulfilment_queues_and_the_drain_sends_one_branded_email(
    db, author, second_user, conflict, capture_source_tag, outbox
):
    _verify(db, author)
    request = _fulfil(db, author, second_user, conflict, capture_source_tag)
    # The action only queues: nothing is sent inside the request.
    assert outbox == []
    [row] = _deliveries(db, author)
    assert (row.channel, row.status) == ("email", "queued")

    assert notification_delivery.drain(db) >= 1

    [message] = [m for m in outbox if m.to == author.email]
    assert second_user.username in message.subject
    assert f"/events/{request.id}" in message.text
    assert f"{settings.frontend_url}/settings" in message.text
    assert message.headers["List-Unsubscribe"] == f"<{settings.frontend_url}/settings>"
    [row] = _deliveries(db, author)
    assert row.status == "sent"
    assert row.sent_at is not None


def test_no_row_when_the_switch_is_off(
    db, author, second_user, conflict, capture_source_tag, outbox
):
    _verify(db, author)
    _email_off(db, author, "request_fulfilled")
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    assert _deliveries(db, author) == []


def test_default_off_kind_queues_only_for_an_analyst_who_turned_it_on(
    db, author, second_user, admin_user
):
    _verify(db, author, second_user)
    db.add(
        UserPreferences(
            user_id=second_user.id, notification_overrides={"new_follower": {"email": True}}
        )
    )
    db.commit()
    headers = login_as(client, admin_user)
    for followed in (author, second_user):
        response = client.post(f"/api/v1/users/{followed.username}/follow", headers=headers)
        assert response.status_code == 204, response.text

    assert _deliveries(db, author) == []
    assert [r.status for r in _deliveries(db, second_user)] == ["queued"]


def test_unverified_address_gets_no_row(
    db, author, second_user, conflict, capture_source_tag, outbox
):
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    assert author.email_verified_at is None
    assert _deliveries(db, author) == []


def test_drain_skips_a_row_whose_switch_or_address_changed(
    db, author, second_user, conflict, capture_source_tag, outbox
):
    _verify(db, author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    _email_off(db, author, "request_fulfilled")

    notification_delivery.drain(db)

    assert [m for m in outbox if m.to == author.email] == []
    assert [r.status for r in _deliveries(db, author)] == ["skipped"]


def test_drain_skips_a_row_whose_event_was_taken_down(
    db, author, second_user, conflict, capture_source_tag, outbox
):
    _verify(db, author)
    request = _fulfil(db, author, second_user, conflict, capture_source_tag)
    db.refresh(request)
    request.hidden_at = datetime.now(UTC)
    db.commit()

    notification_delivery.drain(db)

    assert [r.status for r in _deliveries(db, author)] == ["skipped"]


def test_global_cap_holds_notification_email_but_not_auth_email(
    db, author, second_user, conflict, capture_source_tag, outbox, monkeypatch
):
    _verify(db, author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    monkeypatch.setattr(settings, "notification_email_daily_cap", 0)

    assert notification_delivery.drain(db) == 0
    assert [r.status for r in _deliveries(db, author)] == ["queued"]

    # Auth email is sent inline and never counts against the cap.
    response = client.post("/api/v1/auth/forgot-password", json={"email": author.email})
    assert response.status_code == 204
    assert [m.subject for m in outbox if m.to == author.email] == ["Reset your Vidit password"]


def test_per_user_cap_holds_only_that_recipient(
    db, author, second_user, conflict, capture_source_tag, outbox, monkeypatch
):
    _verify(db, author, second_user)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    _fulfil(db, second_user, author, conflict, capture_source_tag)
    first = _deliveries(db, author)[0]
    first.status = "sent"
    first.sent_at = datetime.now(UTC)
    db.commit()
    monkeypatch.setattr(settings, "notification_email_daily_cap_per_user", 1)

    notification_delivery.drain(db)

    assert [r.status for r in _deliveries(db, author)] == ["sent", "queued"]
    assert [r.status for r in _deliveries(db, second_user)] == ["sent"]


def test_send_failure_never_breaks_the_action(
    db, author, second_user, conflict, capture_source_tag, monkeypatch
):
    def _down(_message: email.Email) -> None:
        raise email.EmailRejectedError("provider down")

    monkeypatch.setattr(email, "send", _down)
    _verify(db, author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)

    [row] = _deliveries(db, author)
    assert (row.status, row.attempts) == ("queued", 1)
    db.expire_all()
    assert db.query(Notification).filter(Notification.user_id == author.id).count() == 1


def test_refusals_retry_after_a_pause_then_fail(
    db, author, second_user, conflict, capture_source_tag, monkeypatch
):
    def _refuse(_message: email.Email) -> None:
        raise email.EmailRejectedError("422")

    monkeypatch.setattr(email, "send", _refuse)
    _verify(db, author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    for attempt in range(1, notification_delivery.MAX_ATTEMPTS + 1):
        notification_delivery.drain(db)
        [row] = _deliveries(db, author)
        assert row.attempts == attempt
        # A second pass inside the retry pause leaves the row alone.
        notification_delivery.drain(db)
        assert _deliveries(db, author)[0].attempts == attempt
        row.claimed_at = datetime.now(UTC) - notification_delivery.RETRY_AFTER
        db.commit()

    assert _deliveries(db, author)[0].status == "failed"


def test_unknown_outcome_stays_sending_then_goes_stale(
    db, author, second_user, conflict, capture_source_tag, monkeypatch
):
    def _timeout(_message: email.Email) -> None:
        raise email.EmailSendError("timeout")

    monkeypatch.setattr(email, "send", _timeout)
    _verify(db, author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)

    notification_delivery.drain(db)
    [row] = _deliveries(db, author)
    assert row.status == "sending"

    row.claimed_at = (
        datetime.now(UTC) - notification_delivery.STALE_SENDING_AFTER - timedelta(minutes=1)
    )
    db.commit()
    notification_delivery.drain(db)
    assert _deliveries(db, author)[0].status == "failed"


def test_a_row_queued_too_long_is_skipped(
    db, author, second_user, conflict, capture_source_tag, outbox, monkeypatch
):
    _verify(db, author)
    _fulfil(db, author, second_user, conflict, capture_source_tag)
    [row] = _deliveries(db, author)
    row.created_at = (
        datetime.now(UTC) - notification_delivery.QUEUED_EXPIRES_AFTER - timedelta(minutes=1)
    )
    db.commit()

    notification_delivery.drain(db)

    assert _deliveries(db, author)[0].status == "skipped"
    assert [m for m in outbox if m.to == author.email] == []
