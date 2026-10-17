"""Stored notifications: the two emitters, the feed's visibility rules, the
unread count and per-row read state."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.event import Event
from app.models.notification import Notification, NotificationDelivery
from app.models.user import User
from app.services import notification_delivery
from app.services.auth import hash_password
from tests.conftest import login_as
from tests.events._helpers import client, notifications_of
from tests.events.test_requests import _geolocate_fulfilment, _make_request

_FEED = "/api/v1/notifications"
_UNREAD = "/api/v1/notifications/unread-count"
_READ = "/api/v1/notifications/read"


def _rows(db, user: User) -> list[Notification]:
    db.expire_all()
    return db.query(Notification).filter(Notification.user_id == user.id).all()


def _unread(user: User) -> int:
    login_as(client, user)
    response = client.get(_UNREAD)
    assert response.status_code == 200, response.text
    return response.json()["count"]


def _notify(db, *, recipient: User, actor: User, event: Event | None = None, **kw) -> Notification:
    row = Notification(
        user_id=recipient.id,
        kind="request_fulfilled" if event is not None else "new_follower",
        actor_id=actor.id,
        event_id=event.id if event is not None else None,
        **kw,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def third_user(db):
    user = User(
        username=f"thd{uuid.uuid4().hex[:8]}",
        email=f"third-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    yield user
    db.query(User).filter(User.id == user.id).delete(synchronize_session=False)
    db.commit()


def test_fulfilment_by_another_analyst_notifies_the_requester(
    db, author, second_user, conflict, capture_source_tag
):
    request = _make_request(db, author=author)
    response = _geolocate_fulfilment(client, request.id, second_user, conflict, capture_source_tag)
    assert response.status_code == 200, response.text

    rows = _rows(db, author)
    assert [(r.kind, r.actor_id, r.event_id) for r in rows] == [
        ("request_fulfilled", second_user.id, request.id)
    ]
    assert _rows(db, second_user) == []

    items = notifications_of(author)
    assert len(items) == 1
    assert items[0]["kind"] == "request_fulfilled"
    assert items[0]["actor"]["username"] == second_user.username
    assert items[0]["event"] == {"id": str(request.id), "title": "Fulfilled from a request"}
    assert items[0]["read_at"] is None


def test_self_fulfilment_notifies_nobody(db, author, conflict, capture_source_tag):
    request = _make_request(db, author=author)
    response = _geolocate_fulfilment(client, request.id, author, conflict, capture_source_tag)
    assert response.status_code == 200, response.text
    assert _rows(db, author) == []


def test_follow_notifies_once_per_follower(db, author, second_user):
    headers = login_as(client, second_user)
    path = f"/api/v1/users/{author.username}/follow"
    assert client.post(path, headers=headers).status_code == 204
    assert client.post(path, headers=headers).status_code == 204
    assert client.delete(path, headers=headers).status_code == 204
    assert client.post(path, headers=headers).status_code == 204

    rows = _rows(db, author)
    assert [(r.kind, r.actor_id, r.event_id) for r in rows] == [
        ("new_follower", second_user.id, None)
    ]
    assert notifications_of(author)[0]["event"] is None


def test_feed_hides_rows_of_deleted_or_hidden_events(db, author, second_user):
    kept = _make_request(db, author=author)
    deleted = _make_request(db, author=author)
    hidden = _make_request(db, author=author)
    for event in (kept, deleted, hidden):
        _notify(db, recipient=author, actor=second_user, event=event)
    assert _unread(author) == 3

    # The takedown lands after the rows were written.
    deleted.deleted_at = datetime.now(UTC)
    hidden.hidden_at = datetime.now(UTC)
    db.commit()

    assert [item["event"]["id"] for item in notifications_of(author)] == [str(kept.id)]
    assert _unread(author) == 1

    hidden.hidden_at = None
    db.commit()
    assert _unread(author) == 2


@pytest.mark.parametrize("gone", ["soft_deleted", "deactivated"])
def test_feed_hides_rows_of_an_actor_who_is_gone(db, author, second_user, third_user, gone):
    _notify(db, recipient=author, actor=second_user)
    _notify(db, recipient=author, actor=third_user)

    if gone == "soft_deleted":
        third_user.deleted_at = datetime.now(UTC)
    else:
        third_user.is_active = False
    db.commit()

    assert [item["actor"]["username"] for item in notifications_of(author)] == [
        second_user.username
    ]
    assert _unread(author) == 1


def test_rows_cascade_with_a_hard_deleted_event(db, author, second_user):
    event = _make_request(db, author=author)
    _notify(db, recipient=author, actor=second_user, event=event)
    db.delete(event)
    db.commit()
    assert _rows(db, author) == []


def _mark(user: User, *rows: Notification | uuid.UUID):
    headers = login_as(client, user)
    ids = [str(r.id if isinstance(r, Notification) else r) for r in rows]
    return client.post(_READ, headers=headers, json={"ids": ids})


def test_read_marks_only_the_rows_shown(db, author, second_user):
    now = datetime.now(UTC)
    older = _notify(db, recipient=author, actor=second_user, created_at=now - timedelta(hours=2))
    newer = _notify(db, recipient=author, actor=second_user, created_at=now - timedelta(hours=1))
    assert _unread(author) == 2

    assert _mark(author, older).status_code == 204
    assert _unread(author) == 1
    feed = notifications_of(author)
    assert [item["id"] for item in feed] == [str(newer.id), str(older.id)]
    assert feed[0]["read_at"] is None
    assert feed[1]["read_at"] is not None

    _mark(author, newer, older)
    assert _unread(author) == 0


def test_a_row_that_commits_late_stays_unread(db, author, second_user):
    """Its ``created_at`` predates a row already read; per-row state keeps it unread."""
    now = datetime.now(UTC)
    shown = _notify(db, recipient=author, actor=second_user, created_at=now)
    _mark(author, shown)
    _notify(db, recipient=author, actor=second_user, created_at=now - timedelta(minutes=5))
    assert _unread(author) == 1


def test_read_leaves_another_analysts_rows_alone(db, author, second_user):
    row = _notify(db, recipient=author, actor=second_user)
    assert _mark(second_user, row).status_code == 204
    assert _unread(author) == 1


def test_read_takes_one_page_of_ids_at_most(author):
    assert _mark(author).status_code == 422
    too_many = [uuid.uuid4() for _ in range(101)]
    assert _mark(author, *too_many).status_code == 422


def _delete(user: User, notification_id: uuid.UUID):
    headers = login_as(client, user)
    return client.delete(f"{_FEED}/{notification_id}", headers=headers)


def test_delete_drops_unsent_deliveries_and_keeps_sent_ones(db, author, second_user):
    row = _notify(db, recipient=author, actor=second_user)
    kept = _notify(db, recipient=author, actor=second_user)
    queued = NotificationDelivery(notification_id=row.id, channel="push")
    sent = NotificationDelivery(
        notification_id=row.id, channel="email", status="sent", sent_at=datetime.now(UTC)
    )
    db.add_all([queued, sent])
    db.commit()
    row_id, queued_id, sent_id = row.id, queued.id, sent.id

    assert _delete(author, row_id).status_code == 204
    assert [r.id for r in _rows(db, author)] == [kept.id]
    assert db.get(NotificationDelivery, queued_id) is None
    assert db.get(NotificationDelivery, sent_id).notification_id is None
    assert _unread(author) == 1
    assert notification_delivery._emails_sent_count(db, now=datetime.now(UTC)) == 1


def test_delete_answers_404_for_another_analysts_row(db, author, second_user):
    row = _notify(db, recipient=author, actor=second_user)
    assert _delete(second_user, row.id).status_code == 404
    assert _delete(author, uuid.uuid4()).status_code == 404
    assert [r.id for r in _rows(db, author)] == [row.id]


def test_feed_pages_with_a_cursor(db, author, second_user):
    now = datetime.now(UTC)
    for minutes in range(3):
        _notify(
            db, recipient=author, actor=second_user, created_at=now - timedelta(minutes=minutes)
        )
    login_as(client, author)
    first = client.get(_FEED, params={"limit": 2})
    assert len(first.json()) == 2
    next_url = first.headers["Link"].split(";")[0].strip("<>")
    second = client.get(next_url)
    assert len(second.json()) == 1
    assert "Link" not in second.headers


def test_feed_is_private_to_the_recipient(db, author, second_user):
    _notify(db, recipient=author, actor=second_user)
    assert notifications_of(second_user) == []
    client.cookies.clear()
    assert client.get(_FEED).status_code == 401
    assert client.get(_UNREAD).status_code == 401
