"""Organization approvals and organization approval requests: who may approve in an
organization's name, one standing approval per organization and version, the reset a new
version brings and whom it notifies, deletion by a site admin, the
organization's approval request audience, resolution and decline, the organization page's lists,
and delivery."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.config import settings
from app.models.approval import EventApproval
from app.models.approval_request import ApprovalRequest
from app.models.audit_log import AuditLog
from app.models.event import Event, EventGeolocator
from app.models.follow import Follow
from app.models.notification import Notification, NotificationDelivery
from app.models.organization import Organization, OrganizationMember
from app.models.user import User
from app.services import email, notification_delivery, organizations
from app.services.approval_requests import REFUSAL_MESSAGE
from app.services.auth import hash_password
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as
from tests.events._helpers import (
    approve,
    client,
    delete_user,
    notifications_of,
    published_geo,
)
from tests.events.test_approval_requests import _age_declines
from tests.events.test_versions import _form, _save_version
from tests.events.test_versions import _published as _published_with_floor

_EVENTS = "/api/v1/events"
_ORGS = "/api/v1/organizations"


@pytest.fixture
def make_user(db):
    made: list[uuid.UUID] = []

    def make(**kw) -> User:
        user = User(
            username=f"oa{uuid.uuid4().hex[:8]}",
            email=f"oa-{uuid.uuid4().hex}@example.com",
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


@pytest.fixture
def make_org(db):
    made: list[uuid.UUID] = []

    def make(
        *, managers: list[User], members: list[User] = (), audience: str = "following"
    ) -> Organization:
        slug = f"org-{uuid.uuid4().hex[:8]}"
        org = Organization(slug=slug, name=f"Org {slug}", approval_request_audience=audience)
        db.add(org)
        db.flush()
        for user in managers:
            db.add(
                OrganizationMember(
                    organization_id=org.id,
                    user_id=user.id,
                    state="active",
                    role="manager",
                    joined_at=datetime.now(UTC),
                )
            )
        for user in members:
            db.add(
                OrganizationMember(
                    organization_id=org.id,
                    user_id=user.id,
                    state="active",
                    role="member",
                    joined_at=datetime.now(UTC),
                )
            )
        db.commit()
        made.append(org.id)
        return org

    yield make
    db.expire_all()
    db.query(Organization).filter(Organization.id.in_(made)).delete(synchronize_session=False)
    db.commit()


def _approve(geo: Event, user: User, org: Organization | None = None, version_no: int = 1):
    return approve(geo, user, version_no, **({"organization": org.slug} if org else {}))


def _ask(geo: Event, requester: User, org: Organization):
    headers = login_as(client, requester)
    return client.post(
        f"{_EVENTS}/{geo.id}/approval-requests", json={"organization": org.slug}, headers=headers
    )


def _decline(geo: Event, request_id: str, user: User):
    headers = login_as(client, user)
    return client.post(
        f"{_EVENTS}/{geo.id}/approval-requests/{request_id}/decline", headers=headers
    )


def _code(response) -> str:
    return response.json()["detail"]["code"]


def _rows(db, user: User, kind: str) -> list[Notification]:
    db.expire_all()
    return (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.kind == kind)
        .all()
    )


# ── Who may approve for an organization ─────────────────────────────


def test_an_org_manager_approves_for_the_organization(db, author, make_user, make_org):
    manager = make_user()
    org = make_org(managers=[manager])
    geo = published_geo(db, author)

    response = _approve(geo, manager, org)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["reviewer"]["username"] == manager.username
    assert body["organization"]["slug"] == org.slug
    assert body["current"] is True

    client.cookies.clear()
    listed = client.get(f"{_EVENTS}/{geo.id}/approvals").json()["items"]
    assert [a["organization"]["slug"] for a in listed] == [org.slug]
    [received] = _rows(db, author, "approval_received")
    assert (received.actor_id, received.organization_id) == (manager.id, org.id)


def test_an_organization_approval_outlives_the_acting_org_managers_account(
    db, author, admin_user, make_user, make_org
):
    acting, other_manager = make_user(), make_user()
    org = make_org(managers=[acting, other_manager])
    geo = published_geo(db, author)
    assert _approve(geo, acting, org).status_code == 201
    assert _approve(geo, acting).status_code == 201

    erased = client.delete(
        f"/api/v1/admin/users/{acting.id}?hard=true", headers=login_as(client, admin_user)
    )
    assert erased.status_code == 200, erased.text

    client.cookies.clear()
    rows = client.get(f"{_EVENTS}/{geo.id}/approvals").json()["items"]
    assert [(r["organization"]["slug"], r["reviewer"], r["current"]) for r in rows] == [
        (org.slug, None, True)
    ]
    listed = client.get(f"{_ORGS}/{org.slug}/approvals").json()
    assert [item["approval"]["reviewer"] for item in listed] == [None]
    duplicate = _approve(geo, other_manager, org)
    assert _code(duplicate) == "already_approved"


def test_an_organization_approval_stays_listed_when_its_member_is_banned(
    db, author, make_user, make_org
):
    acting = make_user()
    org = make_org(managers=[acting, make_user()])
    geo = published_geo(db, author)
    assert _approve(geo, acting, org).status_code == 201
    acting.deleted_at = datetime.now(UTC)
    db.commit()

    client.cookies.clear()
    rows = client.get(f"{_EVENTS}/{geo.id}/approvals").json()["items"]
    assert [(r["organization"]["slug"], r["reviewer"]) for r in rows] == [(org.slug, None)]
    listed = client.get(f"{_ORGS}/{org.slug}/approvals").json()
    assert [item["approval"]["reviewer"] for item in listed] == [None]


def test_a_new_version_asks_no_org_manager_who_holds_credit(
    db, author, make_user, make_org, conflict, capture_source_tag
):
    acting, co = make_user(), make_user()
    org = make_org(managers=[acting, co])
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    assert _approve(geo, acting, org).status_code == 201
    db.add(
        EventGeolocator(event_id=geo.id, user_id=co.id, state="active", joined_at=datetime.now(UTC))
    )
    db.commit()

    saved = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert saved.status_code == 200, saved.text
    assert len(_rows(db, acting, "re_approve_requested")) == 1
    assert _rows(db, co, "re_approve_requested") == []


def test_org_managers_who_hold_credit_are_not_asked(db, author, make_user, make_org):
    outsider, co = make_user(), make_user()
    org = make_org(managers=[outsider, co], audience="everyone")
    geo = published_geo(db, author)
    db.add(
        EventGeolocator(event_id=geo.id, user_id=co.id, state="active", joined_at=datetime.now(UTC))
    )
    db.commit()

    assert _ask(geo, author, org).status_code == 201
    asked = (
        db.query(Notification.user_id)
        .filter(Notification.kind == "approval_request_received", Notification.event_id == geo.id)
        .all()
    )
    assert [user_id for (user_id,) in asked] == [outsider.id]


def test_the_organization_approvals_page_by_cursor_and_skip_unreadable_events(
    db, author, make_user, make_org
):
    acting = make_user()
    org = make_org(managers=[acting])
    events = [published_geo(db, author) for _ in range(4)]
    for geo in events:
        assert _approve(geo, acting, org).status_code == 201
    events[0].hidden_at = datetime.now(UTC)
    events[1].deleted_at = datetime.now(UTC)
    db.commit()

    client.cookies.clear()
    first = client.get(f"{_ORGS}/{org.slug}/approvals", params={"limit": 1})
    assert first.status_code == 200, first.text
    next_url = first.headers["Link"].split(";")[0].strip("<>")
    second = client.get(next_url)
    assert "Link" not in second.headers
    walked = [item["event"]["id"] for item in first.json() + second.json()]
    assert walked == [str(events[3].id), str(events[2].id)]


def test_any_member_approves_in_its_name_and_an_outsider_is_refused(
    db, author, make_user, make_org
):
    manager, member = make_user(), make_user()
    org = make_org(managers=[manager], members=[member])
    geo = published_geo(db, author)

    outsider = _approve(geo, make_user(), org)
    assert outsider.status_code == 403
    assert _code(outsider) == "not_organization_member"

    approved = _approve(geo, member, org)
    assert approved.status_code == 201, approved.text
    assert approved.json()["organization"]["slug"] == org.slug
    assert approved.json()["reviewer"]["id"] == str(member.id)

    headers = login_as(client, manager)
    unknown = client.post(
        f"{_EVENTS}/{geo.id}/approvals",
        json={"version_no": 1, "organization": "no-such-org"},
        headers=headers,
    )
    assert unknown.status_code == 404
    assert _code(unknown) == "organization_not_found"


def test_a_geolocator_cannot_approve_for_an_organization(db, author, make_user, make_org):
    co = make_user()
    org = make_org(managers=[author, co])
    geo = published_geo(db, author)
    db.add(
        EventGeolocator(event_id=geo.id, user_id=co.id, state="active", joined_at=datetime.now(UTC))
    )
    db.commit()

    for user in (author, co):
        response = _approve(geo, user, org)
        assert response.status_code == 403
        assert _code(response) == "geolocator_cannot_approve"


# ── One standing approval per organization and version ──────────────


def test_one_standing_approval_per_organization_and_version(db, author, make_user, make_org):
    first, second = make_user(), make_user()
    org = make_org(managers=[first, second])
    geo = published_geo(db, author)

    placed = _approve(geo, first, org).json()
    duplicate = _approve(geo, second, org)
    assert duplicate.status_code == 409
    assert _code(duplicate) == "already_approved"

    # The org manager's own approval is a separate attestation.
    assert _approve(geo, first).status_code == 201
    assert placed["organization"]["slug"] == org.slug

    other = make_org(managers=[first])
    assert _approve(geo, first, other).status_code == 201


# ── A new version resets organization approvals ─────────────────────


def test_a_new_version_resets_and_asks_every_member(
    db, author, make_user, make_org, conflict, capture_source_tag
):
    acting, other_manager, member = make_user(), make_user(), make_user()
    org = make_org(managers=[acting, other_manager], members=[member])
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    assert _approve(geo, acting, org).status_code == 201
    assert _approve(geo, acting).status_code == 201

    saved = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert saved.status_code == 200, saved.text
    db.refresh(geo)

    client.cookies.clear()
    assert client.get(f"{_EVENTS}/{geo.id}/approvals").json()["items"] == []

    asked = _rows(db, acting, "re_approve_requested")
    assert {r.organization_id for r in asked} == {None, org.id}
    for user in (other_manager, member):
        [for_org] = _rows(db, user, "re_approve_requested")
        assert for_org.organization_id == org.id

    [row] = [n for n in notifications_of(other_manager) if n["kind"] == "re_approve_requested"]
    assert row["organization"]["slug"] == org.slug


def test_a_reapproval_email_names_the_organization(
    db, author, make_user, make_org, conflict, capture_source_tag
):
    manager, member = make_user(), make_user()
    org = make_org(managers=[manager], members=[member])
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    assert _approve(geo, manager, org).status_code == 201
    saved = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert saved.status_code == 200, saved.text
    [asked] = _rows(db, member, "re_approve_requested")
    built = notification_delivery._email_for(asked, "probe@example.com")
    assert built.subject.endswith(f"a geolocation {org.name} approved")


# ── A site admin deletes ────────────────────────────────────────────


def test_a_site_admin_deletes_an_organization_approval_and_it_approves_again(
    db, author, admin_user, make_user, make_org
):
    acting, member = make_user(), make_user()
    org = make_org(managers=[acting], members=[member])
    geo = published_geo(db, author)
    approval = _approve(geo, acting, org).json()

    refused = client.delete(
        f"/api/v1/admin/approvals/{approval['id']}", headers=login_as(client, member)
    )
    assert refused.status_code == 403
    response = client.delete(
        f"/api/v1/admin/approvals/{approval['id']}", headers=login_as(client, admin_user)
    )
    assert response.status_code == 204, response.text
    db.expire_all()
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.actor_id == admin_user.id, AuditLog.action == "approval_deleted")
        .one()
    )
    assert audit.target["organization_id"] == str(org.id)
    assert _rows(db, author, "approval_received") == []

    again = _approve(geo, member, org)
    assert again.status_code == 201, again.text


# ── Approval requests to an organization ──────────────────────────────


def test_following_admits_an_analyst_an_org_manager_follows(db, author, make_user, make_org):
    manager = make_user()
    org = make_org(managers=[manager])
    geo = published_geo(db, author)

    refused = _ask(geo, author, org)
    assert refused.status_code == 403
    assert _code(refused) == "requests_not_accepted"
    assert refused.json()["detail"]["message"] == REFUSAL_MESSAGE

    db.add(Follow(follower_id=manager.id, followed_id=author.id))
    db.commit()
    assert _ask(geo, author, org).status_code == 201


def test_the_org_managers_set_the_audience(db, author, make_user, make_org):
    manager, member = make_user(), make_user()
    org = make_org(managers=[manager], members=[member])
    geo = published_geo(db, author)

    headers = login_as(client, member)
    patch = client.patch(
        f"{_ORGS}/{org.slug}", json={"approval_request_audience": "everyone"}, headers=headers
    )
    assert patch.status_code == 403

    headers = login_as(client, manager)
    patch = client.patch(
        f"{_ORGS}/{org.slug}", json={"approval_request_audience": "everyone"}, headers=headers
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["approval_request_audience"] == "everyone"
    assert _ask(geo, author, org).status_code == 201

    other = published_geo(db, author)
    headers = login_as(client, manager)
    patch = client.patch(
        f"{_ORGS}/{org.slug}", json={"approval_request_audience": "nobody"}, headers=headers
    )
    assert patch.status_code == 200, patch.text
    db.add(Follow(follower_id=manager.id, followed_id=author.id))
    db.commit()
    refused = _ask(other, author, org)
    assert _code(refused) == "requests_not_accepted"
    assert refused.json()["detail"]["message"] == REFUSAL_MESSAGE


def test_the_picker_suggests_organizations_without_revealing_their_audience(
    db, author, make_user, make_org
):
    manager = make_user()
    open_org = make_org(managers=[manager], audience="everyone")
    db.add(Follow(follower_id=manager.id, followed_id=author.id))
    db.commit()
    stranger_org = make_org(managers=[make_user()], audience="everyone")
    closed_org = make_org(managers=[make_user()], audience="nobody")
    own_org = make_org(managers=[author], audience="everyone")
    geo = published_geo(db, author)

    def picked(q: str = "") -> set[str]:
        login_as(client, author)
        response = client.get(f"{_EVENTS}/{geo.id}/approval-request-targets", params={"q": q})
        assert response.status_code == 200, response.text
        return {o["slug"] for o in response.json()["organizations"]}

    listed = picked()
    assert open_org.slug in listed
    assert closed_org.slug not in listed
    # An organization that would take anyone's request stays out until asked for by slug.
    assert stranger_org.slug not in listed
    assert picked(stranger_org.slug) == {stranger_org.slug}
    assert picked(closed_org.slug) == {closed_org.slug}
    # Every org manager of it geolocated the event.
    assert own_org.slug not in listed
    # Another organization's org manager following the requester admits nothing here.
    unfollowed = make_org(managers=[make_user()])
    assert _code(_ask(geo, author, unfollowed)) == "requests_not_accepted"
    assert picked(open_org.slug[4:]) == {open_org.slug}

    assert _ask(geo, author, open_org).status_code == 201
    assert open_org.slug not in picked()

    refused = _ask(geo, author, own_org)
    assert refused.status_code == 403
    assert _code(refused) == "target_is_geolocator"


def test_a_request_reaches_every_member_and_an_approval_resolves_it(
    db, author, make_user, make_org
):
    first, second, member = make_user(), make_user(), make_user()
    org = make_org(managers=[first, second], members=[member], audience="everyone")
    geo = published_geo(db, author)

    created = _ask(geo, author, org)
    assert created.status_code == 201, created.text
    assert created.json()["target"] is None
    assert created.json()["target_organization"]["slug"] == org.slug
    for user in (first, second, member):
        [row] = _rows(db, user, "approval_request_received")
        assert (row.actor_id, row.organization_id) == (author.id, org.id)

    [row] = [n for n in notifications_of(second) if n["kind"] == "approval_request_received"]
    assert row["organization"]["slug"] == org.slug

    login_as(client, second)
    [visible] = client.get(f"{_EVENTS}/{geo.id}/approval-requests").json()
    assert visible["id"] == created.json()["id"]
    login_as(client, member)
    [visible] = client.get(f"{_EVENTS}/{geo.id}/approval-requests").json()
    assert visible["id"] == created.json()["id"]
    login_as(client, make_user())
    assert client.get(f"{_EVENTS}/{geo.id}/approval-requests").json() == []

    duplicate = _ask(geo, author, org)
    assert _code(duplicate) == "already_requested"

    assert _approve(geo, member, org).status_code == 201
    db.expire_all()
    assert db.get(ApprovalRequest, uuid.UUID(created.json()["id"])).status == "approved"
    [received] = _rows(db, author, "approval_received")
    assert received.organization_id == org.id

    again = _ask(geo, author, org)
    assert _code(again) == "already_approved"


def test_any_member_declines_for_the_organization(db, author, make_user, make_org):
    manager, member = make_user(), make_user()
    org = make_org(managers=[manager], members=[member], audience="everyone")
    geo = published_geo(db, author)
    request_id = _ask(geo, author, org).json()["id"]

    assert _decline(geo, request_id, make_user()).status_code == 404
    response = _decline(geo, request_id, member)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "declined"
    [declined] = _rows(db, author, "approval_request_declined")
    assert (declined.actor_id, declined.organization_id) == (member.id, org.id)
    assert _decline(geo, request_id, manager).status_code == 409


def test_a_request_to_a_large_organization_stays_under_the_per_actor_email_cap(
    db, author, make_user, make_org, monkeypatch
):
    """Every member gets the row, and the requester's emails stop at the per-actor cap."""
    monkeypatch.setattr(settings, "notification_email_daily_cap_per_actor", 2)
    manager = make_user()
    members = [make_user() for _ in range(2)]
    org = make_org(managers=[manager], members=members, audience="everyone")
    geo = published_geo(db, author)
    assert _ask(geo, author, org).status_code == 201

    db.expire_all()
    recipients = [manager, *members]
    assert all(_rows(db, user, "approval_request_received") for user in recipients)
    emails = (
        db.query(NotificationDelivery)
        .join(Notification)
        .filter(
            Notification.kind == "approval_request_received",
            Notification.user_id.in_([u.id for u in recipients]),
        )
        .count()
    )
    assert emails == 2


# ── The organization page ───────────────────────────────────────────


def test_the_organization_page_lists_its_approvals_and_open_requests(
    db, author, make_user, make_org
):
    manager, member = make_user(), make_user()
    org = make_org(managers=[manager], members=[member], audience="everyone")
    approved = published_geo(db, author)
    asked = published_geo(db, author)
    approval = _approve(approved, manager, org).json()
    request_id = _ask(asked, author, org).json()["id"]

    client.cookies.clear()
    listed = client.get(f"{_ORGS}/{org.slug}/approvals")
    assert listed.status_code == 200, listed.text
    [row] = listed.json()
    assert row["event"]["id"] == str(approved.id)
    assert row["approval"]["id"] == approval["id"]

    login_as(client, make_user())
    assert client.get(f"{_ORGS}/{org.slug}/approval-requests").status_code == 403
    login_as(client, member)
    [open_row] = client.get(f"{_ORGS}/{org.slug}/approval-requests").json()
    assert open_row["event"]["id"] == str(asked.id)
    assert open_row["request"]["id"] == request_id


# ── Delivery ────────────────────────────────────────────────────────


def test_organization_rows_name_the_organization_in_email(
    db, author, make_user, make_org, monkeypatch
):
    sent: list[email.Email] = []
    monkeypatch.setattr(email, "send", sent.append)
    manager = make_user()
    org = make_org(managers=[manager], audience="everyone")
    geo = published_geo(db, author)
    request_id = _ask(geo, author, org).json()["id"]
    notification_delivery.drain(db)
    [asked] = [m for m in sent if m.to == manager.email]
    assert asked.subject == f"{author.username} asks {org.name} to approve a geolocation"

    assert _decline(geo, request_id, manager).status_code == 200
    _age_declines(db, geo)
    assert _ask(geo, author, org).status_code == 201
    assert _approve(geo, manager, org).status_code == 201
    db.expire_all()
    rows = db.query(Notification).filter(Notification.event_id == geo.id).all()
    assert {r.kind for r in rows} == {
        "approval_request_received",
        "approval_request_declined",
        "approval_received",
    }
    for row in rows:
        built = notification_delivery._email_for(row, "probe@example.com")
        assert org.name in built.subject


# ── Deletion ────────────────────────────────────────────────────────


def _delete_org(org: Organization, user: User):
    return client.delete(f"/api/v1/admin/organizations/{org.slug}", headers=login_as(client, user))


def test_only_a_site_admin_deletes_an_organization(db, author, make_user, make_org):
    manager = make_user()
    org = make_org(managers=[manager])
    assert _delete_org(org, manager).status_code == 403
    client.cookies.clear()
    assert client.delete(f"/api/v1/admin/organizations/{org.slug}").status_code in (401, 403)
    db.expire_all()
    assert db.get(Organization, org.id) is not None


def test_deleting_an_organization_removes_everything_in_its_name(
    db, author, admin_user, make_user, make_org, monkeypatch
):
    swept: list[list[str]] = []
    monkeypatch.setattr(organizations, "sweep_keys", lambda keys, **_: swept.append(list(keys)))
    manager, member, invitee, outsider = make_user(), make_user(), make_user(), make_user()
    org = make_org(managers=[manager], members=[member], audience="everyone")
    db.add(
        OrganizationMember(
            organization_id=org.id,
            user_id=invitee.id,
            invited_by_id=manager.id,
            state="invited",
            role="member",
            invited_at=datetime.now(UTC),
        )
    )
    db.commit()
    picture = client.put(
        f"{_ORGS}/{org.slug}/avatar",
        headers=login_as(client, manager),
        files={"file": ("a.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert picture.status_code == 200, picture.text
    first, second, asked_only = (published_geo(db, author) for _ in range(3))
    assert _approve(first, manager, org).status_code == 201
    assert _approve(second, manager, org).status_code == 201
    assert _approve(first, outsider).status_code == 201
    assert _ask(asked_only, author, org).status_code == 201

    org_id, slug, name = org.id, org.slug, org.name
    assert _delete_org(org, admin_user).status_code == 204

    db.expire_all()
    assert db.get(Organization, org_id) is None
    assert db.query(OrganizationMember).filter_by(organization_id=org_id).count() == 0
    assert db.query(OrganizationMember).filter_by(organization_id=org_id).count() == 0
    assert db.query(ApprovalRequest).filter_by(target_organization_id=org_id).count() == 0
    assert db.query(EventApproval).filter_by(organization_id=org_id).count() == 0
    assert db.query(EventApproval).filter_by(event_id=first.id).count() == 1

    removed = (
        db.query(Notification)
        .filter_by(user_id=author.id, kind="organization_approval_removed")
        .all()
    )
    assert sorted(str(n.event_id) for n in removed) == sorted([str(first.id), str(second.id)])
    assert {(n.organization_name, n.actor_id) for n in removed} == {(name, None)}
    assert (
        db.query(NotificationDelivery)
        .filter(NotificationDelivery.notification_id.in_([n.id for n in removed]))
        .count()
        == 0
    )
    [row] = [n for n in notifications_of(author) if n["kind"] == "organization_approval_removed"][
        :1
    ]
    assert row["organization_name"] == name

    [audit] = [
        event
        for event in db.query(AuditLog).filter_by(action="organization_deleted").all()
        if event.target and event.target.get("slug") == slug
    ]
    assert (audit.actor_id, audit.target["slug"], audit.target["approvals_removed"]) == (
        admin_user.id,
        slug,
        2,
    )
    assert len(swept) == 1 and swept[0][0].startswith(f"avatars/{org_id}/")


def test_deleting_an_unknown_organization_is_not_found(admin_user):
    response = client.delete(
        "/api/v1/admin/organizations/no-such-org", headers=login_as(client, admin_user)
    )
    assert response.status_code == 404


def _listed(**params) -> set[str]:
    response = client.get(_EVENTS, params=params)
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()}


def test_approval_filters_keep_approvals_on_the_live_version(db, make_user, make_org):
    """``approved`` and ``approved_by`` keep an approval on the live version only: one on an
    outdated version drops out. ``approved_by_org`` reads the organization's approval, and
    ``approved_by`` does not match what an analyst placed for it."""
    owner, analyst, manager = make_user(), make_user(), make_user()
    org = make_org(managers=[manager])
    standing, outdated, by_org, unapproved = (published_geo(db, owner) for _ in range(4))
    assert _approve(standing, analyst).status_code == 201
    assert _approve(outdated, analyst).status_code == 201
    outdated.version_no = 2
    db.commit()
    assert _approve(by_org, manager, org).status_code == 201

    assert _listed(author=owner.username, approved="true") == {str(standing.id), str(by_org.id)}
    assert _listed(approved_by=analyst.username.upper()) == {str(standing.id)}
    assert _listed(approved_by=manager.username) == set()
    assert _listed(approved_by_org=org.slug) == {str(by_org.id)}
    assert str(unapproved.id) not in _listed(author=owner.username, approved="true")

    search = client.get(
        "/api/v1/search", params={"q": "", "type": "event", "approved_by_org": org.slug}
    ).json()
    assert [hit["id"] for hit in search["geolocations"]] == [str(by_org.id)]
    points = client.get(
        f"{_EVENTS}/points", params={"bbox": "-90,-180,90,180", "approved_by": analyst.username}
    ).json()
    assert [row[0] for row in points] == [str(standing.id)]
    feed = client.get(
        "/api/v1/feed",
        params={"scope": "all", "approved_by_org": org.slug},
        headers=login_as(client, analyst),
    ).json()
    assert [item["id"] for item in feed] == [str(by_org.id)]


def test_approval_filters_refuse_a_name_outside_the_handle_charset():
    assert client.get(_EVENTS, params={"approved_by": "a%b"}).status_code == 422
    assert client.get(_EVENTS, params={"approved_by_org": "a b"}).status_code == 422
