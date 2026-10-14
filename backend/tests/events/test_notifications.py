"""Stored notifications: the two emitters, the feed's visibility rules, the
unread count and the last-read marker."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.event import Event
from app.models.notification import Notification
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as
from tests.events._helpers import client
from tests.events.test_requests import _geolocate_fulfilment, _make_request

_FEED = "/api/v1/notifications"
_UNREAD = "/api/v1/notifications/unread-count"
_READ = "/api/v1/notifications/read"


def _rows(db, user: User) -> list[Notification]:
    db.expire_all()
    return db.query(Notification).filter(Notification.user_id == user.id).all()


def _feed(user: User) -> list[dict]:
    login_as(client, user)
    response = client.get(_FEED)
    assert response.status_code == 200, response.text
    return response.json()


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

    items = _feed(author)
    assert len(items) == 1
    assert items[0]["kind"] == "request_fulfilled"
    assert items[0]["actor"]["username"] == second_user.username
    assert items[0]["event"] == {"id": str(request.id), "title": "Fulfilled from a request"}
    assert items[0]["unread"] is True


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
    assert _feed(author)[0]["event"] is None


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

    assert [item["event"]["id"] for item in _feed(author)] == [str(kept.id)]
    assert _unread(author) == 1

    hidden.hidden_at = None
    db.commit()
    assert _unread(author) == 2


def test_feed_hides_rows_of_a_soft_deleted_actor(db, author, second_user, third_user):
    _notify(db, recipient=author, actor=second_user)
    _notify(db, recipient=author, actor=third_user)

    third_user.deleted_at = datetime.now(UTC)
    db.commit()

    assert [item["actor"]["username"] for item in _feed(author)] == [second_user.username]
    assert _unread(author) == 1


def test_rows_cascade_with_a_hard_deleted_event(db, author, second_user):
    event = _make_request(db, author=author)
    _notify(db, recipient=author, actor=second_user, event=event)
    db.delete(event)
    db.commit()
    assert _rows(db, author) == []


def test_marker_advances_the_unread_count_and_never_moves_back(db, author, second_user):
    now = datetime.now(UTC)
    older = _notify(db, recipient=author, actor=second_user, created_at=now - timedelta(hours=2))
    newer = _notify(db, recipient=author, actor=second_user, created_at=now - timedelta(hours=1))
    assert _unread(author) == 2

    headers = login_as(client, author)
    response = client.post(_READ, headers=headers, json={"up_to": older.created_at.isoformat()})
    assert response.status_code == 204
    assert _unread(author) == 1
    assert [item["unread"] for item in _feed(author)] == [True, False]

    client.post(_READ, headers=headers, json={"up_to": newer.created_at.isoformat()})
    assert _unread(author) == 0

    client.post(_READ, headers=headers, json={"up_to": older.created_at.isoformat()})
    assert _unread(author) == 0


def test_marker_never_passes_now(db, author, second_user):
    headers = login_as(client, author)
    future = datetime.now(UTC) + timedelta(days=1)
    assert (
        client.post(_READ, headers=headers, json={"up_to": future.isoformat()}).status_code == 204
    )
    _notify(db, recipient=author, actor=second_user)
    assert _unread(author) == 1


def test_marker_rejects_a_naive_timestamp(author):
    headers = login_as(client, author)
    response = client.post(_READ, headers=headers, json={"up_to": "2026-05-01T12:00:00"})
    assert response.status_code == 422


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
    assert _feed(second_user) == []
    client.cookies.clear()
    assert client.get(_FEED).status_code == 401
    assert client.get(_UNREAD).status_code == 401
