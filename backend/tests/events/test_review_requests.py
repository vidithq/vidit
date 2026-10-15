"""Review requests: the target's audience, who may send and receive one, the duplicate rule and
the daily cap, resolution by an approval or a decline, and the notifications and feed rows."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.config import settings
from app.models.event import STATUS_CLOSED, Event, EventGeolocator, EventGeolocatorInvite
from app.models.follow import Follow
from app.models.notification import Notification
from app.models.review_request import ReviewRequest
from app.models.user import User
from app.models.user_preferences import UserPreferences
from app.services import email, notification_delivery
from app.services.auth import hash_password
from app.services.review_requests import REFUSAL_MESSAGE
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client

_EVENTS = "/api/v1/events"


@pytest.fixture
def make_user(db):
    made: list[uuid.UUID] = []

    def make(*, audience: str | None = None, follows: User | None = None) -> User:
        user = User(
            username=f"rr{uuid.uuid4().hex[:8]}",
            email=f"rr-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password("password123"),
        )
        db.add(user)
        db.flush()
        if audience is not None:
            db.add(UserPreferences(user_id=user.id, review_request_audience=audience))
        if follows is not None:
            db.add(Follow(follower_id=user.id, followed_id=follows.id))
        db.commit()
        made.append(user.id)
        return user

    yield make
    db.expire_all()
    for user_id in made:
        db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _published(db, owner: User) -> Event:
    geo = _make_geo(db, author=owner)
    db.add(EventGeolocator(event_id=geo.id, user_id=owner.id))
    db.commit()
    return geo


def _request(geo: Event, requester: User, target: User | str):
    headers = login_as(client, requester)
    username = target if isinstance(target, str) else target.username
    return client.post(
        f"{_EVENTS}/{geo.id}/review-requests", json={"username": username}, headers=headers
    )


def _decline(geo: Event, request_id: str, user: User):
    headers = login_as(client, user)
    return client.post(f"{_EVENTS}/{geo.id}/review-requests/{request_id}/decline", headers=headers)


def _approve(geo: Event, reviewer: User, version_no: int):
    headers = login_as(client, reviewer)
    return client.post(
        f"{_EVENTS}/{geo.id}/approvals", json={"version_no": version_no}, headers=headers
    )


def _open(geo: Event, viewer: User) -> list[dict]:
    login_as(client, viewer)
    response = client.get(f"{_EVENTS}/{geo.id}/review-requests")
    assert response.status_code == 200, response.text
    return response.json()


def _targets(geo: Event, requester: User, q: str = "") -> list[str]:
    login_as(client, requester)
    response = client.get(f"{_EVENTS}/{geo.id}/review-request-targets", params={"q": q})
    assert response.status_code == 200, response.text
    return [u["username"] for u in response.json()["analysts"]]


def _code(response) -> str:
    return response.json()["detail"]["code"]


def _kinds(db, user: User) -> list[tuple[str, uuid.UUID | None, uuid.UUID | None]]:
    db.expire_all()
    rows = db.query(Notification).filter(Notification.user_id == user.id).all()
    return [(r.kind, r.actor_id, r.event_id) for r in rows]


def _feed(user: User) -> list[dict]:
    login_as(client, user)
    return client.get("/api/v1/notifications").json()


# ── The target's audience ───────────────────────────────────────────


def test_by_default_only_analysts_the_target_follows_can_ask(db, author, make_user):
    geo = _published(db, author)
    stranger = make_user()
    response = _request(geo, author, stranger)
    assert response.status_code == 403
    assert _code(response) == "requests_not_accepted"
    assert response.json()["detail"]["message"] == REFUSAL_MESSAGE

    follower_of_author = make_user()
    db.add(Follow(follower_id=author.id, followed_id=follower_of_author.id))
    db.commit()
    # The requester following the target does not count.
    assert _code(_request(geo, author, follower_of_author)) == "requests_not_accepted"

    friend = make_user(follows=author)
    assert _request(geo, author, friend).status_code == 201


def test_everyone_admits_any_analyst(db, author, make_user):
    geo = _published(db, author)
    assert _request(geo, author, make_user(audience="everyone")).status_code == 201


def test_nobody_admits_no_one_not_even_followed_analysts(db, author, make_user):
    geo = _published(db, author)
    closed = make_user(audience="nobody", follows=author)
    response = _request(geo, author, closed)
    assert response.status_code == 403
    assert response.json()["detail"] == {
        "code": "requests_not_accepted",
        "message": REFUSAL_MESSAGE,
    }


def test_the_audience_is_a_preference_the_target_sets(db, author, make_user):
    target = make_user()
    headers = login_as(client, target)
    assert client.get("/api/v1/users/me/preferences").json()["review_request_audience"] == (
        "following"
    )
    response = client.patch(
        "/api/v1/users/me/preferences",
        json={"review_request_audience": "everyone"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["review_request_audience"] == "everyone"
    bad = client.patch(
        "/api/v1/users/me/preferences", json={"review_request_audience": "friends"}, headers=headers
    )
    assert bad.status_code == 422

    geo = _published(db, author)
    assert _request(geo, author, target).status_code == 201


def test_the_picker_suggests_followers_and_never_reveals_an_open_audience(
    db, author, second_user, make_user
):
    geo = _published(db, author)
    friend = make_user(follows=author)
    open_door = make_user(audience="everyone")
    closed = make_user(audience="nobody", follows=author)
    stranger = make_user()
    co = make_user(audience="everyone")
    db.add(EventGeolocator(event_id=geo.id, user_id=co.id))
    db.commit()

    listed = set(_targets(geo, author))
    assert friend.username in listed
    assert not {open_door.username, closed.username, stranger.username} & listed
    # An exact username lists the analyst whatever their audience.
    for exact in (open_door, closed, stranger):
        assert _targets(geo, author, q=exact.username) == [exact.username]
    assert co.username not in listed
    assert author.username not in listed
    assert _targets(geo, author, q=friend.username[2:]) == [friend.username]

    assert _request(geo, author, friend).status_code == 201
    assert friend.username not in _targets(geo, author)

    login_as(client, second_user)
    response = client.get(f"{_EVENTS}/{geo.id}/review-request-targets")
    assert response.status_code == 403
    assert _code(response) == "not_a_geolocator"


# ── Eligibility ─────────────────────────────────────────────────────


def test_only_a_geolocator_can_ask_and_a_co_geolocator_can(db, author, make_user):
    geo = _published(db, author)
    co = make_user()
    db.add(EventGeolocator(event_id=geo.id, user_id=co.id))
    db.commit()
    outsider = make_user()
    target = make_user(audience="everyone")

    response = _request(geo, outsider, target)
    assert response.status_code == 403
    assert _code(response) == "not_a_geolocator"
    assert _request(geo, co, target).status_code == 201


def test_a_geolocator_cannot_be_asked(db, author, make_user):
    geo = _published(db, author)
    co = make_user(audience="everyone")
    db.add(EventGeolocator(event_id=geo.id, user_id=co.id))
    db.commit()
    for target in (co, author):
        response = _request(geo, author, target)
        assert response.status_code == 403
        assert _code(response) == "target_is_geolocator"


@pytest.mark.parametrize("departure", ["left", "removed"])
def test_a_former_geolocator_neither_approves_nor_is_asked(db, author, make_user, departure):
    geo = _published(db, author)
    former = make_user(audience="everyone")
    db.add(EventGeolocator(event_id=geo.id, user_id=former.id))
    db.commit()
    leaver = former if departure == "left" else author
    response = client.delete(
        f"{_EVENTS}/{geo.id}/geolocators/{former.username}", headers=login_as(client, leaver)
    )
    assert response.status_code == 204, response.text

    refused = _approve(geo, former, 1)
    assert (refused.status_code, _code(refused)) == (403, "geolocator_cannot_approve")
    asked = _request(geo, author, former)
    assert (asked.status_code, _code(asked)) == (403, "target_is_geolocator")
    assert former.username not in _targets(geo, author, q=former.username)


def test_unknown_target_and_unpublished_event(db, author, make_user):
    geo = _published(db, author)
    response = _request(geo, author, "nobody-here")
    assert response.status_code == 404
    assert _code(response) == "user_not_found"

    geo.status = STATUS_CLOSED
    geo.closed_at = datetime.now(UTC)
    geo.before_closed_status = "geolocated"
    db.commit()
    response = _request(geo, author, make_user(audience="everyone"))
    assert response.status_code == 409
    assert _code(response) == "invalid_state"


def test_an_analyst_who_reviewed_the_live_version_is_not_asked(db, author, make_user):
    geo = _published(db, author)
    reviewer = make_user(audience="everyone")
    assert _approve(geo, reviewer, 1).status_code == 201
    response = _request(geo, author, reviewer)
    assert response.status_code == 409
    assert _code(response) == "already_approved"


# ── Duplicates and the daily cap ────────────────────────────────────


def test_one_open_request_per_requester_target_and_event(db, author, make_user):
    geo = _published(db, author)
    target = make_user(audience="everyone")
    first = _request(geo, author, target)
    assert first.status_code == 201
    again = _request(geo, author, target)
    assert again.status_code == 409
    assert _code(again) == "already_requested"

    assert _decline(geo, first.json()["id"], target).status_code == 200
    assert _request(geo, author, target).status_code == 201


def test_the_daily_cap_counts_resolved_requests_too(db, author, make_user, monkeypatch):
    monkeypatch.setattr(settings, "review_request_daily_cap", 2)
    geo = _published(db, author)
    a, b, c = (make_user(audience="everyone") for _ in range(3))
    first = _request(geo, author, a)
    assert first.status_code == 201
    assert _decline(geo, first.json()["id"], a).status_code == 200
    assert _request(geo, author, b).status_code == 201

    capped = _request(geo, author, c)
    assert capped.status_code == 429
    assert _code(capped) == "daily_cap_reached"

    db.query(ReviewRequest).filter(ReviewRequest.requester_id == author.id).update(
        {ReviewRequest.created_at: datetime.now(UTC) - timedelta(days=1, minutes=1)}
    )
    db.commit()
    assert _request(geo, author, c).status_code == 201


# ── Resolution and notifications ────────────────────────────────────


def test_a_request_notifies_the_target_and_shows_in_their_feed(db, author, make_user):
    geo = _published(db, author)
    target = make_user(audience="everyone")
    created = _request(geo, author, target).json()
    assert created["status"] == "open"
    assert created["version_no"] == 1
    assert created["target"]["username"] == target.username

    assert _kinds(db, target) == [("review_request_received", author.id, geo.id)]
    [row] = _feed(target)
    assert row["kind"] == "review_request_received"
    assert row["review_request_id"] == created["id"]
    assert row["reapprove_version"] == 1


def test_approving_resolves_the_request_and_tells_the_requester(db, author, make_user):
    geo = _published(db, author)
    co = make_user()
    db.add(EventGeolocator(event_id=geo.id, user_id=co.id))
    db.commit()
    target = make_user(audience="everyone")
    by_owner = _request(geo, author, target).json()
    by_co = _request(geo, co, target).json()
    geo.version_no = 2
    db.commit()

    response = _approve(geo, target, 2)
    assert response.status_code == 201, response.text

    db.expire_all()
    statuses = {
        str(r.id): r.status
        for r in db.query(ReviewRequest).filter(ReviewRequest.event_id == geo.id)
    }
    assert statuses == {by_owner["id"]: "approved", by_co["id"]: "approved"}
    assert _kinds(db, author) == [("approval_received", target.id, geo.id)]
    assert _kinds(db, co) == [("approval_received", target.id, geo.id)]
    assert _open(geo, author) == []
    [row, _] = _feed(target)
    assert row["review_request_id"] is None
    assert row["reapprove_version"] is None


def test_the_target_declines(db, author, second_user, make_user):
    geo = _published(db, author)
    target = make_user(audience="everyone")
    created = _request(geo, author, target).json()

    assert _decline(geo, created["id"], second_user).status_code == 404
    assert _decline(geo, created["id"], author).status_code == 404

    response = _decline(geo, created["id"], target)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "declined"
    assert response.json()["resolved_at"] is not None
    again = _decline(geo, created["id"], target)
    assert again.status_code == 409
    assert _code(again) == "already_resolved"

    assert _open(geo, author) == []
    [row] = _feed(target)
    assert row["review_request_id"] is None
    assert row["reapprove_version"] is None
    assert _kinds(db, author) == [("review_request_declined", target.id, geo.id)]


def test_the_open_list_shows_geolocators_everything_and_targets_their_own(
    db, author, second_user, make_user
):
    geo = _published(db, author)
    a = make_user(audience="everyone")
    b = make_user(audience="everyone")
    _request(geo, author, a)
    _request(geo, author, b)

    assert {r["target"]["username"] for r in _open(geo, author)} == {a.username, b.username}
    assert [r["target"]["username"] for r in _open(geo, a)] == [a.username]
    assert _open(geo, second_user) == []


def test_joining_the_geolocators_drops_requests_to_the_new_geolocator(db, author, make_user):
    geo = _published(db, author)
    target = make_user(audience="everyone")
    assert _request(geo, author, target).status_code == 201
    db.add(EventGeolocatorInvite(event_id=geo.id, user_id=target.id))
    db.commit()

    headers = login_as(client, target)
    accepted = client.post(f"{_EVENTS}/{geo.id}/geolocator-invites/accept", headers=headers)
    assert accepted.status_code == 204, accepted.text
    db.expire_all()
    assert db.query(ReviewRequest).filter(ReviewRequest.event_id == geo.id).count() == 0


# ── Delivery ────────────────────────────────────────────────────────


@pytest.fixture
def outbox(monkeypatch) -> list[email.Email]:
    sent: list[email.Email] = []
    monkeypatch.setattr(email, "send", sent.append)
    return sent


def test_a_request_emails_the_target_and_a_decline_emails_only_on_opt_in(
    db, author, make_user, outbox
):
    geo = _published(db, author)
    target = make_user(audience="everyone")
    now = datetime.now(UTC)
    author.email_verified_at = now
    target.email_verified_at = now
    db.commit()

    created = _request(geo, author, target).json()
    notification_delivery.drain(db)
    [asked] = [m for m in outbox if m.to == target.email]
    assert author.username in asked.subject
    assert f"/events/{geo.id}" in asked.text

    assert _decline(geo, created["id"], target).status_code == 200
    notification_delivery.drain(db)
    assert [m for m in outbox if m.to == author.email] == []

    db.add(
        UserPreferences(
            user_id=author.id, notification_overrides={"review_request_declined": {"email": True}}
        )
    )
    db.commit()
    assert _request(geo, author, target).status_code == 201
    [again] = _open(geo, author)
    assert _decline(geo, again["id"], target).status_code == 200
    notification_delivery.drain(db)
    [declined] = [m for m in outbox if m.to == author.email]
    assert target.username in declined.subject


def test_push_messages_name_the_actor_and_open_the_event(db, author, make_user):
    geo = _published(db, author)
    target = make_user(audience="everyone")
    created = _request(geo, author, target).json()
    assert _decline(geo, created["id"], target).status_code == 200
    db.expire_all()
    rows = db.query(Notification).filter(Notification.event_id == geo.id).all()
    assert {r.kind for r in rows} == {"review_request_received", "review_request_declined"}
    for row in rows:
        message = notification_delivery._PUSH_BUILDERS[row.kind](row)
        assert row.actor.username in message.title
        assert message.path == f"/events/{geo.id}"
