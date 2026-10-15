"""Shared geolocation credit: invitations and their answers, removal, the read surfaces that
credit every geolocator, collections, and the erasure hand-over."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.collection import Collection, CollectionEvent
from app.models.event import STATUS_CLOSED, Event, EventGeolocator, EventGeolocatorInvite
from app.models.notification import Notification
from app.models.user import User
from app.services import email, geolocator_credit, notification_delivery
from app.services.auth import hash_password
from app.services.sanitize import html_from_text
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client

_EVENTS = "/api/v1/events"


@pytest.fixture
def make_user(db):
    made: list[uuid.UUID] = []

    def make(**kw) -> User:
        user = User(
            username=f"cg{uuid.uuid4().hex[:8]}",
            email=f"cg-{uuid.uuid4().hex}@example.com",
            password_hash=hash_password("password123"),
            **kw,
        )
        db.add(user)
        db.commit()
        made.append(user.id)
        return user

    yield make
    db.expire_all()
    for user_id in made:
        db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
        db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _published(db, owner: User, **kw) -> Event:
    geo = _make_geo(db, author=owner, **kw)
    db.add(EventGeolocator(event_id=geo.id, user_id=owner.id))
    db.commit()
    return geo


def _credit(db, geo: Event, user: User, *, at: datetime | None = None) -> None:
    db.add(EventGeolocator(event_id=geo.id, user_id=user.id, created_at=at or datetime.now(UTC)))
    db.commit()


def _invite(geo: Event, owner: User, username: str):
    headers = login_as(client, owner)
    return client.post(
        f"{_EVENTS}/{geo.id}/geolocator-invites", json={"username": username}, headers=headers
    )


def _answer(geo: Event, user: User, verb: str):
    headers = login_as(client, user)
    return client.post(f"{_EVENTS}/{geo.id}/geolocator-invites/{verb}", headers=headers)


def _geolocator_names(geo: Event) -> list[str]:
    client.cookies.clear()
    response = client.get(f"{_EVENTS}/{geo.id}")
    assert response.status_code == 200, response.text
    return [g["username"] for g in response.json()["geolocators"]]


def _notifications(db, user: User) -> list[tuple[str, uuid.UUID | None, uuid.UUID | None]]:
    db.expire_all()
    rows = db.query(Notification).filter(Notification.user_id == user.id).all()
    return [(r.kind, r.actor_id, r.event_id) for r in rows]


# ── Invitations ──────────────────────────────────────────────────────


def test_owner_invites_and_the_invitee_is_notified(db, author, second_user):
    geo = _published(db, author)
    response = _invite(geo, author, second_user.username)
    assert response.status_code == 201, response.text
    assert response.json()["user"]["username"] == second_user.username

    assert _notifications(db, second_user) == [("co_geolocator_invite", author.id, geo.id)]
    login_as(client, second_user)
    feed = client.get("/api/v1/notifications").json()
    assert [(n["kind"], n["invite_pending"]) for n in feed] == [("co_geolocator_invite", True)]


def test_invite_refusals(db, author, second_user, make_user):
    geo = _published(db, author)
    assert _invite(geo, second_user, author.username).status_code == 403
    assert _invite(geo, author, "no-such-analyst").json()["detail"]["code"] == "user_not_found"
    assert _invite(geo, author, author.username).json()["detail"]["code"] == "already_geolocator"
    assert _invite(geo, author, second_user.username).status_code == 201
    repeat = _invite(geo, author, second_user.username)
    assert (repeat.status_code, repeat.json()["detail"]["code"]) == (409, "already_invited")
    banned = make_user(deleted_at=datetime.now(UTC))
    assert _invite(geo, author, banned.username).status_code == 404

    detection = _make_geo(db, author=author, status="detected")
    refused = _invite(detection, author, second_user.username)
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "invalid_state")


def test_invitations_are_capped(db, author, make_user, monkeypatch):
    monkeypatch.setattr(geolocator_credit, "MAX_EVENT_GEOLOCATORS", 2)
    geo = _published(db, author)
    assert _invite(geo, author, make_user().username).status_code == 201
    capped = _invite(geo, author, make_user().username)
    assert capped.json()["detail"]["code"] == "too_many_geolocators"


def test_invite_list_shows_the_owner_all_and_others_their_own(db, author, second_user, make_user):
    geo = _published(db, author)
    third = make_user()
    for invitee in (second_user, third):
        assert _invite(geo, author, invitee.username).status_code == 201

    def names(viewer: User) -> list[str]:
        login_as(client, viewer)
        response = client.get(f"{_EVENTS}/{geo.id}/geolocator-invites")
        assert response.status_code == 200
        return [row["user"]["username"] for row in response.json()]

    assert names(author) == [second_user.username, third.username]
    assert names(third) == [third.username]
    assert names(make_user()) == []


def test_accept_credits_the_invitee(db, author, second_user):
    geo = _published(db, author)
    _invite(geo, author, second_user.username)
    assert _answer(geo, second_user, "accept").status_code == 204

    assert _geolocator_names(geo) == [author.username, second_user.username]
    db.expire_all()
    assert db.get(EventGeolocatorInvite, (geo.id, second_user.id)) is None
    login_as(client, second_user)
    feed = client.get("/api/v1/notifications").json()
    assert feed[0]["invite_pending"] is False
    assert _answer(geo, second_user, "accept").json()["detail"]["code"] == "invite_not_found"


def test_accept_calls_the_approval_revocation_hook(db, author, second_user, monkeypatch):
    calls: list[tuple[uuid.UUID, uuid.UUID]] = []
    monkeypatch.setattr(
        geolocator_credit,
        "revoke_approvals_on_join",
        lambda db, *, geo, user: calls.append((geo.id, user.id)),
    )
    geo = _published(db, author)
    _invite(geo, author, second_user.username)
    assert _answer(geo, second_user, "accept").status_code == 204
    assert calls == [(geo.id, second_user.id)]


def test_accept_after_a_retraction_is_refused(db, author, second_user):
    geo = _published(db, author)
    _invite(geo, author, second_user.username)
    headers = login_as(client, author)
    closed = client.post(f"{_EVENTS}/{geo.id}/close", json={"close_reason": "x"}, headers=headers)
    assert closed.status_code == 200
    refused = _answer(geo, second_user, "accept")
    assert (refused.status_code, refused.json()["detail"]["code"]) == (409, "invalid_state")
    assert _answer(geo, second_user, "decline").status_code == 204


def test_decline_and_withdraw_drop_the_invitation(db, author, second_user, make_user):
    geo = _published(db, author)
    third = make_user()
    _invite(geo, author, second_user.username)
    _invite(geo, author, third.username)

    assert _answer(geo, second_user, "decline").status_code == 204
    headers = login_as(client, author)
    path = f"{_EVENTS}/{geo.id}/geolocator-invites/{third.username}"
    assert client.delete(path, headers=headers).status_code == 204
    assert client.delete(path, headers=headers).status_code == 404

    db.expire_all()
    assert db.query(EventGeolocatorInvite).filter_by(event_id=geo.id).count() == 0
    assert _geolocator_names(geo) == [author.username]


def test_credit_grants_no_edit_right(db, author, second_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    headers = login_as(client, second_user)
    closed = client.post(f"{_EVENTS}/{geo.id}/close", json={"close_reason": "x"}, headers=headers)
    assert closed.status_code == 403
    invited = _invite(geo, second_user, "anyone")
    assert invited.status_code == 403


def test_the_invitation_and_the_hand_over_reach_the_inbox(
    db, admin_user, author, second_user, monkeypatch
):
    outbox: list[email.Email] = []
    monkeypatch.setattr(email, "send", outbox.append)
    second_user.email_verified_at = datetime.now(UTC)
    db.commit()
    owner_name = author.username
    geo = _published(db, author, title="Bridge strike")
    assert _invite(geo, author, second_user.username).status_code == 201
    assert _answer(geo, second_user, "accept").status_code == 204
    # Before the erasure, which takes the invitation row (its actor) along.
    notification_delivery.drain(db)
    _erase(admin_user, author)
    notification_delivery.drain(db)

    subjects = [m.subject for m in outbox if m.to == second_user.email]
    assert f"{owner_name} invites you to share a geolocation" in subjects
    assert "A geolocation you share is now yours" in subjects
    assert all(owner_name not in m.text for m in outbox if "now yours" in m.subject)


# ── Removal ──────────────────────────────────────────────────────────


def _collection_with(db, owner: User, geo: Event) -> Collection:
    collection = Collection(
        owner_id=owner.id,
        title="Shelf",
        description=html_from_text("A shelf."),
        description_text="A shelf.",
    )
    db.add(collection)
    db.flush()
    db.add(CollectionEvent(collection_id=collection.id, event_id=geo.id))
    db.commit()
    return collection


def test_owner_removes_a_co_geolocator(db, author, second_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    collection = _collection_with(db, second_user, geo)

    headers = login_as(client, author)
    path = f"{_EVENTS}/{geo.id}/geolocators/{second_user.username}"
    assert client.delete(path, headers=headers).status_code == 204

    assert _geolocator_names(geo) == [author.username]
    assert _notifications(db, second_user) == [("co_geolocator_removed", author.id, geo.id)]
    assert db.query(CollectionEvent).filter_by(collection_id=collection.id).count() == 0
    again = client.delete(path, headers=login_as(client, author))
    assert again.json()["detail"]["code"] == "geolocator_not_found"


def test_a_co_geolocator_leaves_without_a_notification(db, author, second_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    headers = login_as(client, second_user)
    path = f"{_EVENTS}/{geo.id}/geolocators/{second_user.username}"
    assert client.delete(path, headers=headers).status_code == 204
    assert _geolocator_names(geo) == [author.username]
    assert _notifications(db, second_user) == []


def test_removal_refusals(db, author, second_user, make_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    owner_leaves = client.delete(
        f"{_EVENTS}/{geo.id}/geolocators/{author.username}", headers=login_as(client, author)
    )
    assert (owner_leaves.status_code, owner_leaves.json()["detail"]["code"]) == (
        409,
        "owner_cannot_leave",
    )
    stranger = client.delete(
        f"{_EVENTS}/{geo.id}/geolocators/{second_user.username}",
        headers=login_as(client, make_user()),
    )
    assert stranger.status_code == 403


# ── Read surfaces ────────────────────────────────────────────────────


def test_profile_counts_and_lists_co_credited_work(db, author, second_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    client.cookies.clear()

    profile = client.get(f"/api/v1/users/{second_user.username}").json()
    assert profile["geolocations_count"] == 1
    feed = client.get(f"/api/v1/users/{second_user.username}/events").json()
    assert [item["id"] for item in feed["items"]] == [str(geo.id)]
    assert [g["username"] for g in feed["items"][0]["geolocators"]] == [
        author.username,
        second_user.username,
    ]
    stats = client.get(f"/api/v1/users/{second_user.username}/stats").json()
    assert stats["geolocated_count"] == 1


def test_author_filter_and_search_match_any_geolocator(db, author, second_user):
    geo = _published(db, author, title=f"Credited {uuid.uuid4().hex[:6]}")
    _credit(db, geo, second_user)
    client.cookies.clear()

    listed = client.get(_EVENTS, params={"author": second_user.username.upper()}).json()
    assert [item["id"] for item in listed] == [str(geo.id)]
    found = client.get(
        "/api/v1/search", params={"author": second_user.username, "type": "geolocation"}
    ).json()
    hits = found["geolocations"]
    assert [hit["id"] for hit in hits] == [str(geo.id)]
    assert [g["username"] for g in hits[0]["geolocators"]] == [
        author.username,
        second_user.username,
    ]
    suggestions = client.get("/api/v1/search/authors", params={"q": second_user.username})
    assert second_user.username in suggestions.json()["authors"]


def test_followers_see_co_credited_work_in_their_timeline(db, author, second_user, make_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    follower = make_user()
    headers = login_as(client, follower)
    assert (
        client.post(f"/api/v1/users/{second_user.username}/follow", headers=headers).status_code
        == 204
    )
    timeline = client.get("/api/v1/timeline").json()
    assert [item["id"] for item in timeline["items"]] == [str(geo.id)]


def test_a_co_geolocator_collects_the_event(db, author, second_user, make_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    headers = login_as(client, second_user)
    memberships = client.get(f"{_EVENTS}/{geo.id}/collections")
    assert memberships.status_code == 200
    created = client.post(
        "/api/v1/collections",
        json={
            "title": "Shared work",
            "description": html_from_text("Co-credited."),
            "event_ids": [str(geo.id)],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text

    stranger_headers = login_as(client, make_user())
    assert client.get(f"{_EVENTS}/{geo.id}/collections").status_code == 403
    refused = client.post(
        "/api/v1/collections",
        json={
            "title": "Not mine",
            "description": html_from_text("Nope."),
            "event_ids": [str(geo.id)],
        },
        headers=stranger_headers,
    )
    assert refused.status_code == 403


# ── Erasure hand-over ────────────────────────────────────────────────


def _erase(admin: User, user: User) -> dict:
    response = client.delete(
        f"/api/v1/admin/users/{user.id}?hard=true", headers=login_as(client, admin)
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_erasure_hands_the_event_to_the_co_geolocator(db, admin_user, author, second_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)

    body = _erase(admin_user, author)
    assert (body["cascaded_geolocations"], body["transferred_events"]) == (0, 1)

    db.expire_all()
    kept = db.get(Event, geo.id)
    assert kept is not None and kept.owner_id == second_user.id
    assert _geolocator_names(geo) == [second_user.username]
    assert _notifications(db, second_user) == [("ownership_transferred", None, geo.id)]


def test_erasure_picks_the_earliest_live_co_geolocator(
    db, admin_user, author, second_user, make_user
):
    geo = _published(db, author)
    now = datetime.now(UTC)
    banned = make_user(deleted_at=now)
    later = make_user()
    _credit(db, geo, banned, at=now - timedelta(hours=3))
    _credit(db, geo, second_user, at=now - timedelta(hours=2))
    _credit(db, geo, later, at=now - timedelta(hours=1))

    _erase(admin_user, author)
    db.expire_all()
    assert db.get(Event, geo.id).owner_id == second_user.id
    assert _notifications(db, later) == []


def test_erasure_hands_over_a_retracted_event_too(db, admin_user, author, second_user):
    geo = _published(db, author)
    _credit(db, geo, second_user)
    geo.status = STATUS_CLOSED
    geo.before_closed_status = "geolocated"
    geo.closed_at = datetime.now(UTC)
    geo.close_reason = "retracted"
    db.commit()

    _erase(admin_user, author)
    db.expire_all()
    assert db.get(Event, geo.id).owner_id == second_user.id


def test_erasure_deletes_an_event_with_no_live_co_geolocator(db, admin_user, author, make_user):
    alone = _published(db, author).id
    with_banned = _published(db, author)
    _credit(db, with_banned, make_user(deleted_at=datetime.now(UTC)))
    with_banned_id = with_banned.id

    body = _erase(admin_user, author)
    assert (body["cascaded_geolocations"], body["transferred_events"]) == (2, 0)
    db.expire_all()
    assert db.query(Event).filter(Event.id.in_([alone, with_banned_id])).count() == 0
