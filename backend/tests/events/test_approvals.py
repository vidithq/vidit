"""Approvals: who may approve, one review per analyst and version, the reset a new version
brings (an archive-only save included) and its notifications, revocation, and the
co-geolocator join that revokes."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models.admin_event import AdminEvent
from app.models.approval import EventApproval
from app.models.event import STATUS_CLOSED, Event, EventGeolocator
from app.models.notification import Notification
from app.models.user import User
from app.services.auth import hash_password
from app.services.geolocator_credit import JOINED_AS_GEOLOCATOR_REASON
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client, delete_user
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


def _published(db, owner: User, **kw) -> Event:
    geo = _make_geo(db, author=owner, **kw)
    db.add(EventGeolocator(event_id=geo.id, user_id=owner.id))
    db.commit()
    return geo


def _approve(geo: Event, user: User, version_no: int = 1, **body):
    headers = login_as(client, user)
    return client.post(
        f"{_EVENTS}/{geo.id}/approvals",
        json={"version_no": version_no, **body},
        headers=headers,
    )


def _revoke(geo: Event, approval_id: str, user: User, reason: str = "Wrong building"):
    headers = login_as(client, user)
    return client.post(
        f"{_EVENTS}/{geo.id}/approvals/{approval_id}/revoke",
        json={"reason": reason},
        headers=headers,
    )


def _listed(geo: Event, version_no: int | None = None) -> list[dict]:
    client.cookies.clear()
    query = "" if version_no is None else f"?version_no={version_no}"
    response = client.get(f"{_EVENTS}/{geo.id}/approvals{query}")
    assert response.status_code == 200, response.text
    return response.json()


def _kinds(db, user: User) -> list[tuple[str, uuid.UUID | None, uuid.UUID | None]]:
    db.expire_all()
    rows = db.query(Notification).filter(Notification.user_id == user.id).all()
    return [(r.kind, r.actor_id, r.event_id) for r in rows]


def _feed(user: User) -> list[dict]:
    login_as(client, user)
    return client.get("/api/v1/notifications").json()


# ── Who may approve ──────────────────────────────────────────────────


def test_an_analyst_approves_and_the_owner_is_notified(db, author, second_user):
    geo = _published(db, author)
    response = _approve(geo, second_user, note="  Matches the skyline.  ")
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
    geo = _published(db, author)
    geo.requested_by_id = second_user.id
    db.commit()
    assert _approve(geo, second_user).status_code == 201


def test_geolocators_cannot_approve(db, author, second_user):
    geo = _published(db, author)
    db.add(EventGeolocator(event_id=geo.id, user_id=second_user.id))
    db.commit()
    for user in (author, second_user):
        response = _approve(geo, user)
        assert response.status_code == 403, response.text
        assert response.json()["detail"]["code"] == "geolocator_cannot_approve"
    assert _listed(geo) == []


def test_approving_needs_a_session(db, author):
    geo = _published(db, author)
    client.cookies.clear()
    response = client.post(f"{_EVENTS}/{geo.id}/approvals", json={"version_no": 1})
    assert response.status_code == 401


def test_approval_binds_to_the_version_the_reviewer_read(db, author, second_user):
    geo = _published(db, author)
    geo.version_no = 3
    db.commit()
    response = _approve(geo, second_user, version_no=2)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "version_mismatch"
    assert _approve(geo, second_user, version_no=3).status_code == 201


def test_a_closed_event_takes_no_approval_and_keeps_its_own(db, author, second_user, make_user):
    geo = _published(db, author)
    assert _approve(geo, second_user).status_code == 201
    geo.status = STATUS_CLOSED
    geo.closed_at = datetime.now(UTC)
    geo.before_closed_status = "geolocated"
    db.commit()

    response = _approve(geo, make_user())
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invalid_state"
    # Readable, but no longer current: the claim it attests was closed.
    assert [(a["reviewer"]["username"], a["current"]) for a in _listed(geo)] == [
        (second_user.username, False)
    ]


def test_one_review_per_analyst_and_version(db, author, second_user):
    geo = _published(db, author)
    first = _approve(geo, second_user).json()
    again = _approve(geo, second_user)
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "already_approved"

    assert _revoke(geo, first["id"], second_user).status_code == 200
    assert _approve(geo, second_user).json()["detail"]["code"] == "already_approved"


def test_a_soft_deleted_reviewer_is_left_out(db, author, second_user):
    geo = _published(db, author)
    assert _approve(geo, second_user).status_code == 201
    second_user.deleted_at = datetime.now(UTC)
    db.commit()
    assert _listed(geo) == []


# ── A new version resets ─────────────────────────────────────────────


def test_a_new_version_resets_approvals_and_asks_reviewers_again(
    db, author, second_user, make_user, conflict, capture_source_tag
):
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    third = make_user()
    kept = _approve(geo, second_user).json()
    revoked = _approve(geo, third).json()
    assert _revoke(geo, revoked["id"], third).status_code == 200

    response = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert response.status_code == 200, response.text
    assert response.json()["version_no"] == 2

    assert _listed(geo) == []
    earlier = _listed(geo, version_no=1)
    assert {a["id"]: a["current"] for a in earlier} == {kept["id"]: False, revoked["id"]: False}

    assert _kinds(db, second_user) == [("re_approve_requested", author.id, geo.id)]
    assert _kinds(db, third) == []
    feed = _feed(second_user)
    assert [(n["kind"], n["reapprove_version"], n["approved_version"]) for n in feed] == [
        ("re_approve_requested", 2, 1)
    ]

    assert _approve(geo, second_user, version_no=2).status_code == 201
    assert _feed(second_user)[0]["reapprove_version"] is None
    assert _feed(second_user)[0]["approved_version"] is None
    assert [a["current"] for a in _listed(geo)] == [True]

    client.cookies.clear()
    mine = client.get(f"{_EVENTS}/{geo.id}/approvals?reviewer={second_user.username}").json()
    assert [(a["version_no"], a["current"]) for a in mine] == [(1, False), (2, True)]


def test_an_archive_only_save_resets_approvals_too(
    db, author, second_user, conflict, capture_source_tag
):
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    assert (
        _save_version(geo.id, author, data=_form(conflict, capture_source_tag)).status_code == 200
    )
    assert _approve(geo, second_user, version_no=2).status_code == 201

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
    geo = _published(db, author)
    approval = _approve(geo, second_user).json()

    outsider = _revoke(geo, approval["id"], make_user())
    assert outsider.status_code == 403
    assert outsider.json()["detail"]["code"] == "revoke_forbidden"
    owner = _revoke(geo, approval["id"], author)
    assert owner.status_code == 403

    blank = _revoke(geo, approval["id"], second_user, reason="   ")
    assert blank.status_code == 422

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


def test_a_site_admin_revokes_any_approval_and_is_audited(db, author, second_user, admin_user):
    geo = _published(db, author)
    approval = _approve(geo, second_user).json()

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
    geo = _published(db, author)
    approval = _approve(geo, second_user).json()
    geo.hidden_at = datetime.now(UTC)
    db.commit()

    assert _revoke(geo, approval["id"], second_user).status_code == 404
    response = _revoke(geo, approval["id"], admin_user, reason="Taken down")
    assert response.status_code == 200, response.text


def test_revoking_an_approval_of_another_event_is_not_found(db, author, second_user):
    geo = _published(db, author)
    other = _published(db, author)
    approval = _approve(geo, second_user).json()
    response = _revoke(other, approval["id"], second_user)
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "approval_not_found"


# ── Joining the geolocators ──────────────────────────────────────────


def test_joining_the_geolocators_revokes_the_invitees_approvals(db, author, second_user):
    geo = _published(db, author)
    assert _approve(geo, second_user).status_code == 201
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
