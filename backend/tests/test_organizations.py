"""Organizations: the site admin's create, the public reads, invitations under
mutual follow, roles, removal and leaving, and the last-admin guard."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.admin_event import AdminEvent
from app.models.follow import Follow
from app.models.notification import Notification
from app.models.organization import Organization, OrganizationInvite, OrganizationMember
from app.models.user import User
from app.services.auth import hash_password
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as

client = TestClient(app)

_ADMIN_CREATE = "/api/v1/admin/organizations"


def _org(slug: str) -> str:
    return f"/api/v1/organizations/{slug}"


@pytest.fixture(autouse=True)
def _clear_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def make_user(db):
    created: list[uuid.UUID] = []

    def _make(*, is_admin: bool = False) -> User:
        tag = uuid.uuid4().hex[:8]
        user = User(
            username=f"org{tag}",
            email=f"org-{tag}@example.com",
            password_hash=hash_password("password123"),
            is_admin=is_admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        created.append(user.id)
        return user

    yield _make
    db.rollback()
    db.query(Organization).filter(Organization.created_by_id.in_(created)).delete(
        synchronize_session=False
    )
    db.query(AdminEvent).filter(AdminEvent.actor_id.in_(created)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_(created)).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def site_admin(make_user):
    return make_user(is_admin=True)


@pytest.fixture
def org_admin(make_user):
    return make_user()


@pytest.fixture
def org(site_admin, org_admin):
    slug = f"org-{uuid.uuid4().hex[:8]}"
    headers = login_as(client, site_admin)
    response = client.post(
        _ADMIN_CREATE,
        headers=headers,
        json={
            "name": "Open Source Watch",
            "slug": slug,
            "x_handle": f"@OSW{uuid.uuid4().hex[:6]}",
            "bio": "We geolocate.",
            "external_links": {"website": "https://example.org"},
            "admin_username": org_admin.username,
        },
    )
    assert response.status_code == 201, response.text
    client.cookies.clear()
    return response.json()


def _follow_both(db, a: User, b: User) -> None:
    db.add_all(
        [Follow(follower_id=a.id, followed_id=b.id), Follow(follower_id=b.id, followed_id=a.id)]
    )
    db.commit()


def _invite(inviter: User, slug: str, invitee: User):
    headers = login_as(client, inviter)
    return client.post(
        f"{_org(slug)}/invites", headers=headers, json={"username": invitee.username}
    )


def _join(db, inviter: User, slug: str, invitee: User) -> None:
    _follow_both(db, inviter, invitee)
    assert _invite(inviter, slug, invitee).status_code == 201
    headers = login_as(client, invitee)
    assert client.post(f"{_org(slug)}/invite/accept", headers=headers).status_code == 204


def _code(response) -> str:
    return response.json()["detail"]["code"]


# Create


def test_site_admin_creates_an_organization_with_its_first_admin(db, org, site_admin, org_admin):
    assert org["name"] == "Open Source Watch"
    assert org["x_handle"].startswith("osw")
    assert org["external_links"] == {"website": "https://example.org"}
    assert org["member_count"] == 1
    member = db.query(OrganizationMember).filter_by(organization_id=uuid.UUID(org["id"])).one()
    assert (member.user_id, member.role) == (org_admin.id, "admin")
    audit = db.query(AdminEvent).filter_by(actor_id=site_admin.id).one()
    assert audit.action == "organization_created"
    assert audit.target["slug"] == org["slug"]


def test_analysts_and_organizations_share_one_x_handle_namespace(
    db, org, site_admin, org_admin, make_user
):
    headers = login_as(client, site_admin)
    analyst = make_user()
    taken = client.patch(
        f"/api/v1/admin/users/{analyst.id}/x-handle",
        json={"x_handle": org["x_handle"]},
        headers=headers,
    )
    assert (taken.status_code, _code(taken)) == (409, "x_handle_conflict")

    handle = f"an{uuid.uuid4().hex[:8]}"
    analyst.x_handle = handle
    db.commit()
    refused = client.post(
        _ADMIN_CREATE,
        headers=headers,
        json={
            "name": "Mirror",
            "slug": f"mirror-{uuid.uuid4().hex[:6]}",
            "x_handle": handle,
            "admin_username": org_admin.username,
        },
    )
    assert (refused.status_code, _code(refused)) == (409, "x_handle_conflict")


def test_create_is_site_admin_only(make_user, org_admin):
    headers = login_as(client, make_user())
    response = client.post(
        _ADMIN_CREATE,
        headers=headers,
        json={"name": "X", "slug": "nope", "admin_username": org_admin.username},
    )
    assert response.status_code == 403


@pytest.mark.parametrize("slug", ["A", "-lead", "trail-", "has space", "x" * 51])
def test_create_rejects_a_malformed_slug(site_admin, org_admin, slug):
    headers = login_as(client, site_admin)
    response = client.post(
        _ADMIN_CREATE,
        headers=headers,
        json={"name": "X", "slug": slug, "admin_username": org_admin.username},
    )
    assert response.status_code == 422


def test_create_refuses_a_taken_slug_and_an_unknown_admin(org, site_admin, org_admin):
    headers = login_as(client, site_admin)
    taken = client.post(
        _ADMIN_CREATE,
        headers=headers,
        json={"name": "Copy", "slug": org["slug"], "admin_username": org_admin.username},
    )
    assert taken.status_code == 409
    assert _code(taken) == "slug_taken"
    unknown = client.post(
        _ADMIN_CREATE,
        headers=headers,
        json={"name": "Copy", "slug": f"c-{uuid.uuid4().hex[:6]}", "admin_username": "nobody-x"},
    )
    assert unknown.status_code == 404


# Public reads


def test_public_page_and_viewer_fields(org, org_admin, make_user):
    anonymous = client.get(_org(org["slug"])).json()
    assert anonymous["viewer_role"] is None
    assert anonymous["viewer_can_manage"] is False

    login_as(client, org_admin)
    own = client.get(_org(org["slug"])).json()
    assert own["viewer_role"] == "admin"
    assert own["viewer_can_manage"] is True

    assert client.get(_org("no-such-org")).status_code == 404


def test_members_list_and_profile_memberships(db, org, org_admin, make_user):
    member = make_user()
    _join(db, org_admin, org["slug"], member)
    client.cookies.clear()

    members = client.get(f"{_org(org['slug'])}/members").json()
    assert [(m["user"]["username"], m["role"]) for m in members] == [
        (org_admin.username, "admin"),
        (member.username, "member"),
    ]

    memberships = client.get(f"/api/v1/users/{member.username}/organizations").json()
    assert [(m["organization"]["slug"], m["role"]) for m in memberships] == [
        (org["slug"], "member")
    ]


def test_soft_deleted_members_drop_out_of_the_reads(db, org, org_admin, make_user):
    member = make_user()
    _join(db, org_admin, org["slug"], member)
    member.deleted_at = datetime.now(UTC)
    db.merge(member)
    db.commit()
    client.cookies.clear()
    assert len(client.get(f"{_org(org['slug'])}/members").json()) == 1
    assert client.get(_org(org["slug"])).json()["member_count"] == 1


# Invitations


def test_invite_requires_mutual_follow(db, org, org_admin, make_user):
    invitee = make_user()
    refused = _invite(org_admin, org["slug"], invitee)
    assert refused.status_code == 403
    assert _code(refused) == "not_mutual_follow"

    db.add(Follow(follower_id=org_admin.id, followed_id=invitee.id))
    db.commit()
    assert _code(_invite(org_admin, org["slug"], invitee)) == "not_mutual_follow"

    db.add(Follow(follower_id=invitee.id, followed_id=org_admin.id))
    db.commit()
    assert _invite(org_admin, org["slug"], invitee).status_code == 201
    again = _invite(org_admin, org["slug"], invitee)
    assert again.status_code == 409
    assert _code(again) == "already_invited"


def test_only_an_org_admin_invites(db, org, org_admin, make_user):
    member, outsider = make_user(), make_user()
    _join(db, org_admin, org["slug"], member)
    _follow_both(db, member, outsider)
    refused = _invite(member, org["slug"], outsider)
    assert refused.status_code == 403
    assert _code(refused) == "not_organization_admin"


def test_candidates_are_mutual_follows_not_yet_in_or_invited(db, org, org_admin, make_user):
    mutual, one_way, invited, member = make_user(), make_user(), make_user(), make_user()
    _follow_both(db, org_admin, mutual)
    db.add(Follow(follower_id=org_admin.id, followed_id=one_way.id))
    db.commit()
    _follow_both(db, org_admin, invited)
    assert _invite(org_admin, org["slug"], invited).status_code == 201
    _join(db, org_admin, org["slug"], member)

    login_as(client, org_admin)
    candidates = client.get(f"{_org(org['slug'])}/invite-candidates").json()
    assert [c["username"] for c in candidates] == [mutual.username]

    pending = client.get(f"{_org(org['slug'])}/invites").json()
    assert [p["user"]["username"] for p in pending] == [invited.username]


def test_accept_joins_and_notifies_both_sides(db, org, org_admin, make_user):
    invitee = make_user()
    _follow_both(db, org_admin, invitee)
    assert _invite(org_admin, org["slug"], invitee).status_code == 201

    login_as(client, invitee)
    page = client.get(_org(org["slug"])).json()
    assert page["viewer_invited"] is True
    feed = client.get("/api/v1/notifications").json()
    assert feed[0]["kind"] == "organization_invite"
    assert feed[0]["organization"]["slug"] == org["slug"]
    assert feed[0]["actor"]["username"] == org_admin.username

    headers = login_as(client, invitee)
    assert client.post(f"{_org(org['slug'])}/invite/accept", headers=headers).status_code == 204
    page = client.get(_org(org["slug"])).json()
    assert (page["viewer_role"], page["viewer_invited"]) == ("member", False)
    assert db.query(OrganizationInvite).filter_by(user_id=invitee.id).count() == 0

    accepted = (
        db.query(Notification)
        .filter_by(user_id=org_admin.id, kind="organization_invite_accepted")
        .one()
    )
    assert accepted.actor_id == invitee.id

    again = client.post(f"{_org(org['slug'])}/invite/accept", headers=headers)
    assert again.status_code == 404


def test_decline_drops_the_invite_silently(db, org, org_admin, make_user):
    invitee = make_user()
    _follow_both(db, org_admin, invitee)
    assert _invite(org_admin, org["slug"], invitee).status_code == 201
    headers = login_as(client, invitee)
    assert client.post(f"{_org(org['slug'])}/invite/decline", headers=headers).status_code == 204
    assert db.query(OrganizationInvite).filter_by(user_id=invitee.id).count() == 0
    assert db.query(OrganizationMember).filter_by(user_id=invitee.id).count() == 0
    assert db.query(Notification).filter_by(user_id=org_admin.id).count() == 0


def test_org_admin_cancels_an_invite(db, org, org_admin, make_user):
    invitee = make_user()
    _follow_both(db, org_admin, invitee)
    invite_id = _invite(org_admin, org["slug"], invitee).json()["id"]
    headers = login_as(client, org_admin)
    path = f"{_org(org['slug'])}/invites/{invite_id}"
    assert client.delete(path, headers=headers).status_code == 204
    assert client.delete(path, headers=headers).status_code == 404


def test_an_analyst_joins_several_organizations(db, org, site_admin, org_admin, make_user):
    second_admin, analyst = make_user(), make_user()
    headers = login_as(client, site_admin)
    second = client.post(
        _ADMIN_CREATE,
        headers=headers,
        json={
            "name": "Another collective",
            "slug": f"two-{uuid.uuid4().hex[:6]}",
            "admin_username": second_admin.username,
        },
    ).json()
    _join(db, org_admin, org["slug"], analyst)
    _join(db, second_admin, second["slug"], analyst)
    names = [
        m["organization"]["name"]
        for m in client.get(f"/api/v1/users/{analyst.username}/organizations").json()
    ]
    assert names == ["Another collective", "Open Source Watch"]


# Roles, removal, leaving


def test_last_admin_cannot_leave_or_be_demoted(org, org_admin):
    headers = login_as(client, org_admin)
    members = f"{_org(org['slug'])}/members/{org_admin.username}"
    demote = client.patch(members, headers=headers, json={"role": "member"})
    assert demote.status_code == 409
    assert _code(demote) == "last_admin"
    leave = client.delete(members, headers=headers)
    assert leave.status_code == 409
    assert _code(leave) == "last_admin"


def test_promote_then_the_former_admin_may_leave(db, org, org_admin, make_user):
    member = make_user()
    _join(db, org_admin, org["slug"], member)
    headers = login_as(client, org_admin)
    promoted = client.patch(
        f"{_org(org['slug'])}/members/{member.username}", headers=headers, json={"role": "admin"}
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "admin"
    leave = client.delete(f"{_org(org['slug'])}/members/{org_admin.username}", headers=headers)
    assert leave.status_code == 204


def test_member_leaves_but_cannot_remove_others(db, org, org_admin, make_user):
    a, b = make_user(), make_user()
    _join(db, org_admin, org["slug"], a)
    _join(db, org_admin, org["slug"], b)
    headers = login_as(client, a)
    refused = client.delete(f"{_org(org['slug'])}/members/{b.username}", headers=headers)
    assert refused.status_code == 403
    role = client.patch(
        f"{_org(org['slug'])}/members/{a.username}", headers=headers, json={"role": "admin"}
    )
    assert role.status_code == 403
    assert (
        client.delete(f"{_org(org['slug'])}/members/{a.username}", headers=headers).status_code
        == 204
    )


def test_org_admin_removes_a_member(db, org, org_admin, make_user):
    member = make_user()
    _join(db, org_admin, org["slug"], member)
    headers = login_as(client, org_admin)
    path = f"{_org(org['slug'])}/members/{member.username}"
    assert client.delete(path, headers=headers).status_code == 204
    assert client.delete(path, headers=headers).status_code == 404


def test_site_admin_manages_any_organization(db, org, site_admin, make_user, org_admin):
    member = make_user()
    _join(db, org_admin, org["slug"], member)
    headers = login_as(client, site_admin)
    assert client.get(_org(org["slug"])).json()["viewer_can_manage"] is True
    promoted = client.patch(
        f"{_org(org['slug'])}/members/{member.username}", headers=headers, json={"role": "admin"}
    )
    assert promoted.status_code == 200


# Profile edit


def test_org_admin_edits_bio_links_and_picture(db, org, org_admin, make_user):
    headers = login_as(client, org_admin)
    response = client.patch(
        _org(org["slug"]),
        headers=headers,
        json={"bio": "  New framing  ", "external_links": {"x": "@osw", "website": None}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["bio"] == "New framing"
    assert response.json()["external_links"] == {"x": "osw"}

    picture = client.put(
        f"{_org(org['slug'])}/avatar",
        headers=headers,
        files={"file": ("a.jpg", TINY_JPEG, "image/jpeg")},
    )
    assert picture.status_code == 200, picture.text
    assert f"avatars/{org['id']}/" in picture.json()["avatar_url"]
    cleared = client.delete(f"{_org(org['slug'])}/avatar", headers=headers)
    assert cleared.json()["avatar_url"] is None

    other = make_user()
    refused = client.patch(
        _org(org["slug"]), headers=login_as(client, other), json={"bio": "taken over"}
    )
    assert refused.status_code == 403
    assert (
        client.patch(_org(org["slug"]), headers=headers, json={"name": "Renamed"}).status_code
        == 422
    )


# Erasure of the last org-admin


@pytest.mark.parametrize("hard", [True, False])
def test_erasing_the_last_admin_promotes_the_earliest_member(
    db, org, site_admin, org_admin, make_user, hard
):
    first, second = make_user(), make_user()
    _join(db, org_admin, org["slug"], first)
    _join(db, org_admin, org["slug"], second)

    headers = login_as(client, site_admin)
    suffix = "?hard=true" if hard else ""
    response = client.delete(f"/api/v1/admin/users/{org_admin.id}{suffix}", headers=headers)
    assert response.status_code == 200, response.text

    db.expire_all()
    roles = {
        m.user_id: m.role
        for m in db.query(OrganizationMember).filter_by(organization_id=uuid.UUID(org["id"]))
    }
    assert (roles[first.id], roles[second.id]) == ("admin", "member")
    inherited = db.query(Notification).filter_by(kind="organization_admin_inherited").all()
    assert [(n.user_id, n.actor_id, str(n.organization_id)) for n in inherited] == [
        (first.id, None, org["id"])
    ]


def test_no_handover_while_another_admin_is_live(db, org, site_admin, org_admin, make_user):
    co_admin, member = make_user(), make_user()
    _join(db, org_admin, org["slug"], co_admin)
    _join(db, org_admin, org["slug"], member)
    headers = login_as(client, org_admin)
    client.patch(
        f"{_org(org['slug'])}/members/{co_admin.username}", headers=headers, json={"role": "admin"}
    )

    headers = login_as(client, site_admin)
    erased = client.delete(f"/api/v1/admin/users/{org_admin.id}?hard=true", headers=headers)
    assert erased.status_code == 200
    db.expire_all()
    assert db.query(OrganizationMember).filter_by(user_id=member.id).one().role == "member"
    assert db.query(Notification).filter_by(kind="organization_admin_inherited").count() == 0


def test_an_organization_left_without_admin_is_flagged(db, org, site_admin, org_admin):
    headers = login_as(client, site_admin)
    erased = client.delete(f"/api/v1/admin/users/{org_admin.id}?hard=true", headers=headers)
    assert erased.status_code == 200

    rows = client.get(_ADMIN_CREATE, headers=headers).json()
    flagged = next(r for r in rows if r["slug"] == org["slug"])
    assert (flagged["member_count"], flagged["admin_count"]) == (0, 0)
    assert rows[0]["admin_count"] == 0


def test_a_site_admin_names_an_org_admin_for_an_organization_left_without_one(
    db, org, site_admin, org_admin, make_user
):
    headers = login_as(client, site_admin)
    assert client.delete(f"/api/v1/admin/users/{org_admin.id}?hard=true", headers=headers)
    heir = make_user()
    path = f"{_ADMIN_CREATE}/{org['slug']}/admins"

    assert client.post(path, json={"username": "nobody-at-all"}, headers=headers).status_code == 404
    response = client.post(path, json={"username": heir.username}, headers=headers)
    assert response.status_code == 201, response.text
    assert (response.json()["user"]["username"], response.json()["role"]) == (
        heir.username,
        "admin",
    )
    rows = client.get(_ADMIN_CREATE, headers=headers).json()
    assert next(r for r in rows if r["slug"] == org["slug"])["admin_count"] == 1
    audit = db.query(AdminEvent).filter_by(action="organization_admin_appointed").all()
    assert [a.target["user_id"] for a in audit] == [str(heir.id)]

    login_as(client, heir)
    assert client.post(path, json={"username": heir.username}).status_code == 403
