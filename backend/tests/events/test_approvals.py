"""Approvals: who may approve, one review per analyst and version, the reset a new version
brings (an archive-only save included) and its notifications, and the two deletions: a site
admin's, and the co-geolocator join."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models.approval import EventApproval
from app.models.audit_log import AuditLog
from app.models.event import STATUS_CLOSED, Event, EventGeolocator
from app.models.notification import Notification
from app.models.user import User
from app.services import approvals
from app.services.auth import hash_password
from tests.conftest import login_as
from tests.events._helpers import (
    approve,
    client,
    delete_user,
    notifications_of,
    published_geo,
)
from tests.events.test_versions import _form, _save_version
from tests.events.test_versions import _published as _published_with_floor

_EVENTS = "/api/v1/events"


@pytest.fixture
def make_user(db):
    made: list[uuid.UUID] = []

    def make(**kw) -> User:
        user = User(
            username=f"ap{uuid.uuid4().hex[:8]}",
            email=f"ap-{uuid.uuid4().hex}@example.com",
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
        delete_user(db, user_id)
    db.commit()


def _delete(approval_id: str, user: User):
    headers = login_as(client, user)
    return client.delete(f"/api/v1/admin/approvals/{approval_id}", headers=headers)


def _listed(geo: Event, version_no: int | None = None) -> list[dict]:
    client.cookies.clear()
    query = "" if version_no is None else f"?version_no={version_no}"
    response = client.get(f"{_EVENTS}/{geo.id}/approvals{query}")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _may_approve(geo: Event, user: User | None) -> bool:
    if user is None:
        client.cookies.clear()
        response = client.get(f"{_EVENTS}/{geo.id}/approvals")
    else:
        response = client.get(f"{_EVENTS}/{geo.id}/approvals", headers=login_as(client, user))
    assert response.status_code == 200, response.text
    return response.json()["viewer_can_approve"]


def _kinds(db, user: User) -> list[tuple[str, uuid.UUID | None, uuid.UUID | None]]:
    db.expire_all()
    rows = db.query(Notification).filter(Notification.user_id == user.id).all()
    return [(r.kind, r.actor_id, r.event_id) for r in rows]


# ── Who may approve ──────────────────────────────────────────────────


def test_an_analyst_approves_and_the_owner_is_notified(db, author, second_user):
    geo = published_geo(db, author)
    response = approve(geo, second_user)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["version_no"] == 1
    assert body["reviewer"]["username"] == second_user.username
    assert body["current"] is True
    assert set(body) == {"id", "version_no", "reviewer", "organization", "created_at", "current"}

    assert [a["id"] for a in _listed(geo)] == [body["id"]]
    assert _kinds(db, author) == [("approval_received", second_user.id, geo.id)]


def test_the_analyst_who_requested_a_fulfilled_event_may_approve_it(db, author, second_user):
    geo = published_geo(db, author)
    geo.requested_by_id = second_user.id
    db.commit()
    assert approve(geo, second_user).status_code == 201


def test_geolocators_cannot_approve(db, author, second_user):
    geo = published_geo(db, author)
    db.add(
        EventGeolocator(
            event_id=geo.id, user_id=second_user.id, state="active", joined_at=datetime.now(UTC)
        )
    )
    db.commit()
    for user in (author, second_user):
        response = approve(geo, user)
        assert response.status_code == 403, response.text
        assert response.json()["detail"]["code"] == "geolocator_cannot_approve"
    assert _listed(geo) == []


def test_the_list_says_whether_the_caller_may_approve(db, author, second_user, make_user):
    geo = published_geo(db, author)
    assert _may_approve(geo, second_user) is True
    assert _may_approve(geo, author) is False
    assert _may_approve(geo, None) is False

    former = make_user()
    db.add(
        EventGeolocator(
            event_id=geo.id, user_id=former.id, state="active", joined_at=datetime.now(UTC)
        )
    )
    db.commit()
    assert _may_approve(geo, former) is False
    left = client.delete(
        f"{_EVENTS}/{geo.id}/geolocators/{former.username}", headers=login_as(client, former)
    )
    assert left.status_code == 204, left.text
    assert _may_approve(geo, former) is False

    assert approve(geo, second_user).status_code == 201
    assert _may_approve(geo, second_user) is True


def test_approving_needs_a_session(db, author):
    geo = published_geo(db, author)
    client.cookies.clear()
    response = client.post(f"{_EVENTS}/{geo.id}/approvals", json={"version_no": 1})
    assert response.status_code == 401


def test_approval_binds_to_the_version_the_reviewer_read(db, author, second_user):
    geo = published_geo(db, author)
    geo.version_no = 3
    db.commit()
    response = approve(geo, second_user, version_no=2)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "version_mismatch"
    assert approve(geo, second_user, version_no=3).status_code == 201


def test_a_closed_event_takes_no_approval_and_keeps_its_own(db, author, second_user, make_user):
    geo = published_geo(db, author)
    assert approve(geo, second_user).status_code == 201
    geo.status = STATUS_CLOSED
    geo.closed_at = datetime.now(UTC)
    geo.before_closed_status = "geolocated"
    db.commit()

    response = approve(geo, make_user())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"
    # Readable, but no longer current: the claim it attests was closed.
    assert [(a["reviewer"]["username"], a["current"]) for a in _listed(geo)] == [
        (second_user.username, False)
    ]


def test_the_list_is_capped(db, author, make_user, monkeypatch):
    monkeypatch.setattr(approvals, "MAX_APPROVALS_LISTED", 2)
    geo = published_geo(db, author)
    placed = [approve(geo, make_user()).json()["id"] for _ in range(3)]
    assert [a["id"] for a in _listed(geo)] == placed[1:]


def test_one_standing_approval_per_analyst_and_version(db, author, second_user):
    geo = published_geo(db, author)
    approve(geo, second_user).json()
    again = approve(geo, second_user)
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_approved"


def test_an_approval_takes_no_note(db, author, second_user):
    geo = published_geo(db, author)
    response = approve(geo, second_user, note="Matches the skyline.")
    assert response.status_code == 422


def test_a_soft_deleted_reviewer_is_left_out(db, author, second_user):
    geo = published_geo(db, author)
    assert approve(geo, second_user).status_code == 201
    second_user.deleted_at = datetime.now(UTC)
    db.commit()
    assert _listed(geo) == []


# ── A new version resets ─────────────────────────────────────────────


def test_a_new_version_resets_approvals_and_asks_reviewers_again(
    db, author, second_user, make_user, conflict, capture_source_tag
):
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    third = make_user()
    kept = approve(geo, second_user).json()
    other = approve(geo, third).json()

    response = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 2

    assert _listed(geo) == []
    earlier = _listed(geo, version_no=1)
    assert {a["id"]: a["current"] for a in earlier} == {kept["id"]: False, other["id"]: False}

    assert _kinds(db, second_user) == [("re_approve_requested", author.id, geo.id)]
    assert _kinds(db, third) == [("re_approve_requested", author.id, geo.id)]
    feed = notifications_of(second_user)
    assert [n["kind"] for n in feed] == ["re_approve_requested"]

    assert approve(geo, second_user, version_no=2).status_code == 201
    assert [a["current"] for a in _listed(geo)] == [True]

    client.cookies.clear()
    mine = client.get(f"{_EVENTS}/{geo.id}/approvals?reviewer={second_user.username}").json()[
        "items"
    ]
    assert [(a["version_no"], a["current"]) for a in mine] == [(1, False), (2, True)]
    every = client.get(f"{_EVENTS}/{geo.id}/approvals?all_versions=true").json()["items"]
    assert [(a["id"], a["version_no"]) for a in every] == [
        (kept["id"], 1),
        (other["id"], 1),
        (mine[1]["id"], 2),
    ]


def test_an_archive_only_save_resets_approvals_too(
    db, author, second_user, conflict, capture_source_tag
):
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )
    assert approve(geo, second_user, version_no=2).status_code == 201

    wayback = f"https://web.archive.org/web/20260811120000/{geo.source_url}"
    response = _save_version(
        geo.id, author, data=_form(conflict, capture_source_tag, source_snapshot_url=wayback)
    )
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 3

    assert _listed(geo) == []
    assert [a["current"] for a in _listed(geo, version_no=2)] == [False]
    assert _kinds(db, second_user) == [("re_approve_requested", author.id, geo.id)]


# ── A site admin deletes ─────────────────────────────────────────────


def test_a_site_admin_deletes_an_approval_and_is_audited(db, author, second_user, admin_user):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()
    assert [n["kind"] for n in notifications_of(author)] == ["approval_received"]

    assert _delete(approval["id"], second_user).status_code == 403
    response = _delete(approval["id"], admin_user)
    assert response.status_code == 204, response.text

    assert _listed(geo) == []
    assert notifications_of(author) == []
    db.expire_all()
    assert db.get(EventApproval, uuid.UUID(approval["id"])) is None
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == admin_user.id, AuditLog.action == "approval_deleted")
        .one()
    )
    assert audit.target["approval_id"] == approval["id"]
    assert audit.target["geolocation_id"] == str(geo.id)
    assert audit.target["reviewer_id"] == str(second_user.id)


def test_a_site_admin_deletes_on_a_withheld_event(db, author, second_user, admin_user):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()
    geo.hidden_at = datetime.now(UTC)
    db.commit()
    assert _delete(approval["id"], admin_user).status_code == 204


def test_deleting_an_unknown_approval_is_not_found(db, admin_user):
    response = _delete(str(uuid.uuid4()), admin_user)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "approval_not_found"


def test_the_revoke_endpoint_is_gone(db, author, second_user):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()
    response = client.post(
        f"{_EVENTS}/{geo.id}/approvals/{approval['id']}/revoke",
        headers=login_as(client, second_user),
    )
    assert response.status_code in (404, 405)


# ── Joining the geolocators ──────────────────────────────────────────


def test_joining_the_geolocators_deletes_the_invitees_approvals(db, author, second_user):
    geo = published_geo(db, author)
    assert approve(geo, second_user).status_code == 201
    headers = login_as(client, author)
    invited = client.post(
        f"{_EVENTS}/{geo.id}/geolocator-invites",
        json={"username": second_user.username},
        headers=headers,
    )
    assert invited.status_code == 201, invited.text
    headers = login_as(client, second_user)
    assert (
        client.post(f"{_EVENTS}/{geo.id}/geolocator-invites/accept", headers=headers).status_code
        == 204
    )

    assert _listed(geo) == []
    db.expire_all()
    assert db.query(EventApproval).filter(EventApproval.event_id == geo.id).count() == 0
    assert [n["kind"] for n in notifications_of(author)] == []
