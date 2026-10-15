"""Organization approvals and organization review requests: who may approve in an
organization's name, one standing approval per organization and version, the reset a new
version brings and whom it notifies, revocation by an org-admin or a site admin, the
organization's review request audience, resolution and decline, the organization page's lists,
and delivery."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.models.admin_event import AdminEvent
from app.models.event import Event, EventGeolocator
from app.models.follow import Follow
from app.models.notification import Notification
from app.models.organization import Organization, OrganizationMember
from app.models.review_request import ReviewRequest
from app.models.user import User
from app.services import email, notification_delivery
from app.services.auth import hash_password
from app.services.review_requests import REFUSAL_MESSAGE
from tests.conftest import login_as
from tests.events._helpers import _make_geo, client, delete_user
from tests.events.test_review_requests import _age_declines
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
        *, admins: list[User], members: list[User] = (), audience: str = "following"
    ) -> Organization:
        slug = f"org-{uuid.uuid4().hex[:8]}"
        org = Organization(slug=slug, name=f"Org {slug}", review_request_audience=audience)
        db.add(org)
        db.flush()
        for user in admins:
            db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="admin"))
        for user in members:
            db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="member"))
        db.commit()
        made.append(org.id)
        return org

    yield make
    db.expire_all()
    db.query(Organization).filter(Organization.id.in_(made)).delete(synchronize_session=False)
    db.commit()


def _published(db, owner: User) -> Event:
    geo = _make_geo(db, author=owner)
    db.add(EventGeolocator(event_id=geo.id, user_id=owner.id))
    db.commit()
    return geo


def _approve(geo: Event, user: User, org: Organization | None = None, version_no: int = 1):
    headers = login_as(client, user)
    body: dict = {"version_no": version_no}
    if org is not None:
        body["organization"] = org.slug
    return client.post(f"{_EVENTS}/{geo.id}/approvals", json=body, headers=headers)


def _revoke(geo: Event, approval_id: str, user: User):
    headers = login_as(client, user)
    return client.post(
        f"{_EVENTS}/{geo.id}/approvals/{approval_id}/revoke",
        json={"reason": "Wrong building"},
        headers=headers,
    )


def _ask(geo: Event, requester: User, org: Organization):
    headers = login_as(client, requester)
    return client.post(
        f"{_EVENTS}/{geo.id}/review-requests", json={"organization": org.slug}, headers=headers
    )


def _decline(geo: Event, request_id: str, user: User):
    headers = login_as(client, user)
    return client.post(f"{_EVENTS}/{geo.id}/review-requests/{request_id}/decline", headers=headers)


def _code(response) -> str:
    return response.json()["detail"]["code"]


def _rows(db, user: User, kind: str) -> list[Notification]:
    db.expire_all()
    return (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.kind == kind)
        .all()
    )


def _feed(user: User) -> list[dict]:
    login_as(client, user)
    return client.get("/api/v1/notifications").json()


# ── Who may approve for an organization ─────────────────────────────


def test_an_org_admin_approves_for_the_organization(db, author, make_user, make_org):
    admin = make_user()
    org = make_org(admins=[admin])
    geo = _published(db, author)

    response = _approve(geo, admin, org)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["reviewer"]["username"] == admin.username
    assert body["organization"]["slug"] == org.slug
    assert body["current"] is True

    client.cookies.clear()
    listed = client.get(f"{_EVENTS}/{geo.id}/approvals").json()
    assert [a["organization"]["slug"] for a in listed] == [org.slug]
    [received] = _rows(db, author, "approval_received")
    assert (received.actor_id, received.organization_id) == (admin.id, org.id)


def test_an_organization_approval_outlives_the_acting_org_admins_account(
    db, author, admin_user, make_user, make_org
):
    acting, other_admin = make_user(), make_user()
    org = make_org(admins=[acting, other_admin])
    geo = _published(db, author)
    assert _approve(geo, acting, org).status_code == 201
    assert _approve(geo, acting).status_code == 201

    erased = client.delete(
        f"/api/v1/admin/users/{acting.id}?hard=true", headers=login_as(client, admin_user)
    )
    assert erased.status_code == 200, erased.text

    client.cookies.clear()
    rows = client.get(f"{_EVENTS}/{geo.id}/approvals").json()
    assert [(r["organization"]["slug"], r["reviewer"], r["current"]) for r in rows] == [
        (org.slug, None, True)
    ]
    listed = client.get(f"{_ORGS}/{org.slug}/approvals").json()
    assert [item["approval"]["reviewer"] for item in listed] == [None]
    revoked = client.post(
        f"{_EVENTS}/{geo.id}/approvals/{rows[0]['id']}/revoke",
        json={"reason": "Checked again"},
        headers=login_as(client, other_admin),
    )
    assert revoked.status_code == 200, revoked.text


def test_only_an_org_admin_approves_in_its_name(db, author, make_user, make_org):
    admin, member = make_user(), make_user()
    org = make_org(admins=[admin], members=[member])
    geo = _published(db, author)

    refused = _approve(geo, member, org)
    assert refused.status_code == 403
    assert _code(refused) == "not_organization_admin"

    outsider = _approve(geo, make_user(), org)
    assert _code(outsider) == "not_organization_admin"

    headers = login_as(client, admin)
    unknown = client.post(
        f"{_EVENTS}/{geo.id}/approvals",
        json={"version_no": 1, "organization": "no-such-org"},
        headers=headers,
    )
    assert unknown.status_code == 404
    assert _code(unknown) == "organization_not_found"


def test_a_geolocator_cannot_approve_for_an_organization(db, author, make_user, make_org):
    co = make_user()
    org = make_org(admins=[author, co])
    geo = _published(db, author)
    db.add(EventGeolocator(event_id=geo.id, user_id=co.id))
    db.commit()

    for user in (author, co):
        response = _approve(geo, user, org)
        assert response.status_code == 403
        assert _code(response) == "geolocator_cannot_approve"


# ── One standing approval per organization and version ──────────────


def test_one_standing_approval_per_organization_and_version(db, author, make_user, make_org):
    first, second = make_user(), make_user()
    org = make_org(admins=[first, second])
    geo = _published(db, author)

    placed = _approve(geo, first, org).json()
    duplicate = _approve(geo, second, org)
    assert duplicate.status_code == 409
    assert _code(duplicate) == "already_approved"

    # The org-admin's own approval is a separate attestation.
    assert _approve(geo, first).status_code == 201

    assert _revoke(geo, placed["id"], second).status_code == 200
    again = _approve(geo, second, org)
    assert again.status_code == 201, again.text

    other = make_org(admins=[first])
    assert _approve(geo, first, other).status_code == 201


# ── A new version resets organization approvals ─────────────────────


def test_a_new_version_resets_and_asks_the_org_admins(
    db, author, make_user, make_org, conflict, capture_source_tag
):
    acting, other_admin, member = make_user(), make_user(), make_user()
    org = make_org(admins=[acting, other_admin], members=[member])
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    assert _approve(geo, acting, org).status_code == 201
    assert _approve(geo, acting).status_code == 201

    saved = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert saved.status_code == 200, saved.text
    db.refresh(geo)

    client.cookies.clear()
    assert client.get(f"{_EVENTS}/{geo.id}/approvals").json() == []

    asked = _rows(db, acting, "re_approve_requested")
    assert {r.organization_id for r in asked} == {None, org.id}
    [for_org] = _rows(db, other_admin, "re_approve_requested")
    assert for_org.organization_id == org.id
    assert _rows(db, member, "re_approve_requested") == []

    [row] = [n for n in _feed(other_admin) if n["kind"] == "re_approve_requested"]
    assert row["organization"]["slug"] == org.slug
    assert row["reapprove_version"] == geo.version_no
    assert row["approved_version"] == 1

    assert _approve(geo, other_admin, org, version_no=geo.version_no).status_code == 201
    [row] = [n for n in _feed(acting) if n["organization"]]
    assert row["reapprove_version"] is None


def test_a_demoted_admin_loses_the_organization_offer(
    db, author, make_user, make_org, conflict, capture_source_tag
):
    admin, demoted = make_user(), make_user()
    org = make_org(admins=[admin, demoted])
    geo = _published_with_floor(db, author, conflict, capture_source_tag)
    assert _approve(geo, admin, org).status_code == 201
    saved = _save_version(geo.id, author, data=_form(conflict, capture_source_tag))
    assert saved.status_code == 200, saved.text
    [asked] = _rows(db, demoted, "re_approve_requested")
    message = notification_delivery._PUSH_BUILDERS["re_approve_requested"](asked)
    assert message.title.endswith(f"a geolocation {org.name} approved")

    db.query(OrganizationMember).filter(OrganizationMember.user_id == demoted.id).update(
        {"role": "member"}
    )
    db.commit()
    [row] = [n for n in _feed(demoted) if n["kind"] == "re_approve_requested"]
    assert row["reapprove_version"] is None


# ── Revocation ──────────────────────────────────────────────────────


def test_an_org_admin_revokes_the_organization_approval(db, author, make_user, make_org):
    acting, other_admin, member = make_user(), make_user(), make_user()
    org = make_org(admins=[acting, other_admin], members=[member])
    geo = _published(db, author)
    approval = _approve(geo, acting, org).json()

    refused = _revoke(geo, approval["id"], member)
    assert refused.status_code == 403
    assert _code(refused) == "revoke_forbidden"

    response = _revoke(geo, approval["id"], other_admin)
    assert response.status_code == 200, response.text
    assert response.json()["revoked_as"] == "organization_admin"
    assert response.json()["revoke_reason"] == "Wrong building"
    db.expire_all()
    assert db.query(AdminEvent).filter(AdminEvent.actor_id == other_admin.id).count() == 0


def test_the_acting_member_revokes_only_while_org_admin(db, author, make_user, make_org):
    acting, keeper = make_user(), make_user()
    org = make_org(admins=[acting, keeper])
    geo = _published(db, author)
    approval = _approve(geo, acting, org).json()

    db.query(OrganizationMember).filter(OrganizationMember.user_id == acting.id).update(
        {"role": "member"}
    )
    db.commit()
    assert _code(_revoke(geo, approval["id"], acting)) == "revoke_forbidden"

    db.query(OrganizationMember).filter(OrganizationMember.user_id == acting.id).update(
        {"role": "admin"}
    )
    db.commit()
    response = _revoke(geo, approval["id"], acting)
    assert response.json()["revoked_as"] == "reviewer"


def test_a_site_admin_revokes_an_organization_approval(db, author, admin_user, make_user, make_org):
    acting = make_user()
    org = make_org(admins=[acting])
    geo = _published(db, author)
    approval = _approve(geo, acting, org).json()

    response = _revoke(geo, approval["id"], admin_user)
    assert response.json()["revoked_as"] == "site_admin"
    db.expire_all()
    audit = (
        db.query(AdminEvent)
        .filter(AdminEvent.actor_id == admin_user.id, AdminEvent.action == "approval_revoked")
        .one()
    )
    assert audit.target["organization_id"] == str(org.id)


# ── Review requests to an organization ──────────────────────────────


def test_following_admits_an_analyst_an_org_admin_follows(db, author, make_user, make_org):
    admin = make_user()
    org = make_org(admins=[admin])
    geo = _published(db, author)

    refused = _ask(geo, author, org)
    assert refused.status_code == 403
    assert _code(refused) == "requests_not_accepted"
    assert refused.json()["detail"]["message"] == REFUSAL_MESSAGE

    db.add(Follow(follower_id=admin.id, followed_id=author.id))
    db.commit()
    assert _ask(geo, author, org).status_code == 201


def test_the_org_admins_set_the_audience(db, author, make_user, make_org):
    admin, member = make_user(), make_user()
    org = make_org(admins=[admin], members=[member])
    geo = _published(db, author)

    headers = login_as(client, member)
    patch = client.patch(
        f"{_ORGS}/{org.slug}", json={"review_request_audience": "everyone"}, headers=headers
    )
    assert patch.status_code == 403

    headers = login_as(client, admin)
    patch = client.patch(
        f"{_ORGS}/{org.slug}", json={"review_request_audience": "everyone"}, headers=headers
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["review_request_audience"] == "everyone"
    assert _ask(geo, author, org).status_code == 201

    other = _published(db, author)
    headers = login_as(client, admin)
    patch = client.patch(
        f"{_ORGS}/{org.slug}", json={"review_request_audience": "nobody"}, headers=headers
    )
    assert patch.status_code == 200, patch.text
    db.add(Follow(follower_id=admin.id, followed_id=author.id))
    db.commit()
    refused = _ask(other, author, org)
    assert _code(refused) == "requests_not_accepted"
    assert refused.json()["detail"]["message"] == REFUSAL_MESSAGE


def test_the_picker_suggests_organizations_without_revealing_their_audience(
    db, author, make_user, make_org
):
    admin = make_user()
    open_org = make_org(admins=[admin], audience="everyone")
    db.add(Follow(follower_id=admin.id, followed_id=author.id))
    db.commit()
    stranger_org = make_org(admins=[make_user()], audience="everyone")
    closed_org = make_org(admins=[make_user()], audience="nobody")
    own_org = make_org(admins=[author], audience="everyone")
    geo = _published(db, author)

    def picked(q: str = "") -> set[str]:
        login_as(client, author)
        response = client.get(f"{_EVENTS}/{geo.id}/review-request-targets", params={"q": q})
        assert response.status_code == 200, response.text
        return {o["slug"] for o in response.json()["organizations"]}

    listed = picked()
    assert open_org.slug in listed
    assert closed_org.slug not in listed
    # An organization that would take anyone's request stays out until asked for by slug.
    assert stranger_org.slug not in listed
    assert picked(stranger_org.slug) == {stranger_org.slug}
    assert picked(closed_org.slug) == {closed_org.slug}
    # Every org-admin of it geolocated the event.
    assert own_org.slug not in listed
    # Another organization's org-admin following the requester admits nothing here.
    unfollowed = make_org(admins=[make_user()])
    assert _code(_ask(geo, author, unfollowed)) == "requests_not_accepted"
    assert picked(open_org.slug[4:]) == {open_org.slug}

    assert _ask(geo, author, open_org).status_code == 201
    assert open_org.slug not in picked()

    refused = _ask(geo, author, own_org)
    assert refused.status_code == 403
    assert _code(refused) == "target_is_geolocator"


def test_a_request_reaches_every_org_admin_and_an_approval_resolves_it(
    db, author, make_user, make_org
):
    first, second, member = make_user(), make_user(), make_user()
    org = make_org(admins=[first, second], members=[member], audience="everyone")
    geo = _published(db, author)

    created = _ask(geo, author, org)
    assert created.status_code == 201, created.text
    assert created.json()["target"] is None
    assert created.json()["target_organization"]["slug"] == org.slug
    for admin in (first, second):
        [row] = _rows(db, admin, "review_request_received")
        assert (row.actor_id, row.organization_id) == (author.id, org.id)
    assert _rows(db, member, "review_request_received") == []

    [row] = [n for n in _feed(second) if n["kind"] == "review_request_received"]
    assert row["review_request_id"] == created.json()["id"]
    assert row["reapprove_version"] == 1

    login_as(client, second)
    [visible] = client.get(f"{_EVENTS}/{geo.id}/review-requests").json()
    assert visible["id"] == created.json()["id"]
    login_as(client, member)
    assert client.get(f"{_EVENTS}/{geo.id}/review-requests").json() == []

    duplicate = _ask(geo, author, org)
    assert _code(duplicate) == "already_requested"

    assert _approve(geo, first, org).status_code == 201
    db.expire_all()
    assert db.get(ReviewRequest, uuid.UUID(created.json()["id"])).status == "approved"
    [received] = _rows(db, author, "approval_received")
    assert received.organization_id == org.id

    again = _ask(geo, author, org)
    assert _code(again) == "already_approved"


def test_any_org_admin_declines_for_the_organization(db, author, make_user, make_org):
    first, second, member = make_user(), make_user(), make_user()
    org = make_org(admins=[first, second], members=[member], audience="everyone")
    geo = _published(db, author)
    request_id = _ask(geo, author, org).json()["id"]

    assert _decline(geo, request_id, member).status_code == 404
    response = _decline(geo, request_id, second)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "declined"
    [declined] = _rows(db, author, "review_request_declined")
    assert (declined.actor_id, declined.organization_id) == (second.id, org.id)
    assert _decline(geo, request_id, first).status_code == 409


# ── The organization page ───────────────────────────────────────────


def test_the_organization_page_lists_its_approvals_and_open_requests(
    db, author, make_user, make_org
):
    admin, member = make_user(), make_user()
    org = make_org(admins=[admin], members=[member], audience="everyone")
    approved = _published(db, author)
    asked = _published(db, author)
    approval = _approve(approved, admin, org).json()
    request_id = _ask(asked, author, org).json()["id"]

    client.cookies.clear()
    listed = client.get(f"{_ORGS}/{org.slug}/approvals")
    assert listed.status_code == 200, listed.text
    [row] = listed.json()
    assert row["event"]["id"] == str(approved.id)
    assert row["approval"]["id"] == approval["id"]

    login_as(client, member)
    assert client.get(f"{_ORGS}/{org.slug}/review-requests").status_code == 403
    login_as(client, admin)
    [open_row] = client.get(f"{_ORGS}/{org.slug}/review-requests").json()
    assert open_row["event"]["id"] == str(asked.id)
    assert open_row["request"]["id"] == request_id


# ── Delivery ────────────────────────────────────────────────────────


def test_organization_rows_name_the_organization_in_email_and_push(
    db, author, make_user, make_org, monkeypatch
):
    sent: list[email.Email] = []
    monkeypatch.setattr(email, "send", sent.append)
    admin = make_user(email_verified_at=datetime.now(UTC))
    org = make_org(admins=[admin], audience="everyone")
    geo = _published(db, author)
    request_id = _ask(geo, author, org).json()["id"]
    notification_delivery.drain(db)
    [asked] = [m for m in sent if m.to == admin.email]
    assert asked.subject == f"{author.username} asks {org.name} to review a geolocation"

    assert _decline(geo, request_id, admin).status_code == 200
    _age_declines(db, geo)
    assert _ask(geo, author, org).status_code == 201
    assert _approve(geo, admin, org).status_code == 201
    db.expire_all()
    rows = db.query(Notification).filter(Notification.event_id == geo.id).all()
    assert {r.kind for r in rows} == {
        "review_request_received",
        "review_request_declined",
        "approval_received",
    }
    for row in rows:
        message = notification_delivery._PUSH_BUILDERS[row.kind](row)
        assert org.name in message.title
        assert message.path == f"/events/{geo.id}"
        built = notification_delivery._EMAIL_BUILDERS[row.kind](row, "probe@example.com")
        assert org.name in built.subject
