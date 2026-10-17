"""Approvals: who may approve, one review per analyst and version, the reset a new version
brings (an archive-only save included) and its notifications, revocation, and the
co-geolocator join that revokes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models.admin_event import AdminEvent
from app.models.approval import JOINED_AS_GEOLOCATOR_REASON, EventApproval
from app.models.event import STATUS_CLOSED, Event, EventGeolocator
from app.models.notification import Notification
from app.models.user import User
from app.services import approvals, notification_delivery
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


def _revoke(geo: Event, approval_id: str, user: User, reason: str | None = "Wrong building"):
    headers = login_as(client, user)
    return client.post(
        f"{_EVENTS}/{geo.id}/approvals/{approval_id}/revoke",
        json=None if reason is None else {"reason": reason},
        headers=headers,
    )


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
    response = approve(geo, second_user, note="  Matches the skyline.  ")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["version_no"] == 1
    assert body["reviewer"]["username"] == second_user.username
    assert body["note"] == "Matches the skyline."
    assert body["current"] is True
    assert body["revoked_at"] is None

    assert [a["id"] for a in _listed(geo)] == [body["id"]]
    assert _kinds(db, author) == [("approval_received", second_user.id, geo.id)]


def test_the_analyst_who_requested_a_fulfilled_event_may_approve_it(db, author, second_user):
    geo = published_geo(db, author)
    geo.requested_by_id = second_user.id
    db.commit()
    assert approve(geo, second_user).status_code == 201


def test_geolocators_cannot_approve(db, author, second_user):
    geo = published_geo(db, author)
    db.add(EventGeolocator(event_id=geo.id, user_id=second_user.id))
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
    db.add(EventGeolocator(event_id=geo.id, user_id=former.id))
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


def test_a_reviewer_who_revoked_their_own_approval_approves_again(db, author, second_user):
    geo = published_geo(db, author)
    first = approve(geo, second_user).json()
    assert _revoke(geo, first["id"], second_user, reason=None).status_code == 200
    assert _may_approve(geo, second_user) is True

    again = approve(geo, second_user)
    assert again.status_code == 201, again.text
    assert again.json()["id"] != first["id"]
    listed = _listed(geo)
    assert [(a["id"], a["revoked_at"] is None) for a in listed] == [
        (first["id"], False),
        (again.json()["id"], True),
    ]
    assert approve(geo, second_user).json()["detail"]["code"] == "already_approved"


def test_a_revocation_by_a_site_admin_closes_the_version_to_the_reviewer(
    db, author, second_user, admin_user
):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()
    assert _revoke(geo, approval["id"], admin_user).status_code == 200

    refused = approve(geo, second_user)
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "reapproval_refused"


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
    revoked = approve(geo, third).json()
    assert _revoke(geo, revoked["id"], third).status_code == 200

    response = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 2

    assert _listed(geo) == []
    earlier = _listed(geo, version_no=1)
    assert {a["id"]: a["current"] for a in earlier} == {kept["id"]: False, revoked["id"]: False}

    assert _kinds(db, second_user) == [("re_approve_requested", author.id, geo.id)]
    assert _kinds(db, third) == []
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
        (revoked["id"], 1),
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


# ── Revocation ───────────────────────────────────────────────────────


def test_the_reviewer_revokes_with_a_public_reason(db, author, second_user, make_user):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()

    outsider = _revoke(geo, approval["id"], make_user())
    assert outsider.status_code == 403
    assert outsider.json()["detail"]["code"] == "revoke_forbidden"
    owner = _revoke(geo, approval["id"], author)
    assert owner.status_code == 403

    too_long = _revoke(geo, approval["id"], second_user, reason="x" * 2001)
    assert too_long.status_code == 422

    response = _revoke(geo, approval["id"], second_user, reason="  The shadows disagree.  ")
    assert response.status_code == 200, response.text
    assert response.json()["revoke_reason"] == "The shadows disagree."

    (listed,) = _listed(geo)
    assert listed["current"] is False
    assert listed["revoked_at"] is not None
    assert listed["revoke_reason"] == "The shadows disagree."
    assert listed["revoked_as"] == "reviewer"

    again = _revoke(geo, approval["id"], second_user)
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_revoked"


@pytest.mark.parametrize("reason", [None, "   "])
def test_the_reason_is_optional_and_a_blank_one_is_stored_as_null(db, author, second_user, reason):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()

    response = _revoke(geo, approval["id"], second_user, reason=reason)
    assert response.status_code == 200, response.text
    assert response.json()["revoked_at"] is not None
    assert response.json()["revoke_reason"] is None
    db.expire_all()
    row = db.get(EventApproval, uuid.UUID(approval["id"]))
    assert row is not None and row.revoked_at is not None and row.revoke_reason is None


def test_a_revoke_notifies_the_owner_and_hides_the_approval_notice(db, author, second_user):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()
    assert [n["kind"] for n in notifications_of(author)] == ["approval_received"]

    assert _revoke(geo, approval["id"], second_user, reason=None).status_code == 200

    feed = notifications_of(author)
    assert [(n["kind"], n["actor"]["id"]) for n in feed] == [
        ("approval_revoked", str(second_user.id))
    ]
    assert feed[0]["event"]["id"] == str(geo.id)
    unread = client.get("/api/v1/notifications/unread-count").json()["count"]
    assert unread == 1
    assert ("approval_received", second_user.id, geo.id) in _kinds(db, author)
    assert not db.query(Notification).filter_by(user_id=second_user.id).count()

    [row] = db.query(Notification).filter_by(user_id=author.id, kind="approval_revoked").all()
    built = notification_delivery._email_for(row, "probe@example.com")
    assert second_user.username in built.subject
    message = notification_delivery._push_for(row)
    assert message.path == f"/events/{geo.id}"


def test_a_revoke_hides_only_the_notice_of_the_revoked_approval(
    db, author, second_user, conflict, capture_source_tag
):
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    first = approve(geo, second_user).json()
    saved = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert saved.status_code == 200, saved.text
    second = approve(geo, second_user, version_no=2).json()

    assert _revoke(geo, first["id"], second_user).status_code == 200

    received = [n for n in notifications_of(author) if n["kind"] == "approval_received"]
    assert len(received) == 1
    db.expire_all()
    [shown] = (
        db.query(Notification)
        .filter_by(user_id=author.id, kind="approval_received")
        .filter(Notification.id == uuid.UUID(received[0]["id"]))
        .all()
    )
    assert shown.approval_id == uuid.UUID(second["id"])


def test_a_site_admin_revokes_any_approval_and_is_audited(db, author, second_user, admin_user):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()

    response = _revoke(geo, approval["id"], admin_user, reason="Sockpuppet account")
    assert response.status_code == 200, response.text
    assert response.json()["revoked_as"] == "site_admin"

    db.expire_all()
    audit = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "approval_revoked")
        .one()
    )
    assert audit.target["approval_id"] == approval["id"]


def test_a_site_admin_revokes_on_a_withheld_event_and_others_find_none(
    db, author, second_user, admin_user
):
    geo = published_geo(db, author)
    approval = approve(geo, second_user).json()
    geo.hidden_at = datetime.now(UTC)
    db.commit()

    assert _revoke(geo, approval["id"], second_user).status_code == 404
    response = _revoke(geo, approval["id"], admin_user, reason="Taken down")
    assert response.status_code == 200, response.text


def test_revoking_an_approval_of_another_event_is_not_found(db, author, second_user):
    geo = published_geo(db, author)
    other = published_geo(db, author)
    approval = approve(geo, second_user).json()
    response = _revoke(other, approval["id"], second_user)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "approval_not_found"


# ── Joining the geolocators ──────────────────────────────────────────


def test_joining_the_geolocators_revokes_the_invitees_approvals(db, author, second_user):
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

    (listed,) = _listed(geo)
    assert listed["current"] is False
    assert listed["revoke_reason"] == JOINED_AS_GEOLOCATOR_REASON
    assert listed["revoked_as"] == "reviewer"
    db.expire_all()
    assert (
        db.query(EventApproval)
        .filter(EventApproval.revoked_at.is_(None))
        .filter(EventApproval.event_id == geo.id)
        .count()
        == 0
    )
