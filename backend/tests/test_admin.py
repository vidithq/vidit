import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.config import settings
from app.dependencies import LAST_SEEN_THROTTLE
from app.main import app
from app.models.archive_import_job import ArchiveImportJob
from app.models.audit_log import ACTION_LOGIN, AuditLog
from app.models.bot_mention import BotMention
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.invite_code import InviteCode
from app.models.media import Media
from app.models.source import Source
from app.models.upload import UPLOAD_TTL, Upload
from app.models.user import User
from app.services import storage as storage_module
from tests._fixtures import (
    TINY_JPEG,
    audit_row,
    client,
    fake_sha256,
    make_event,
    source,
    store_bytes,
    stored_path,
)
from tests.conftest import DEFAULT_PASSWORD, login_as


def test_admin_me_returns_200_for_admin(admin_user):
    response = client.get("/api/v1/admin/me", headers=login_as(client, admin_user))
    assert response.status_code == 200
    assert response.json() == {"is_admin": True}


def test_admin_me_answers_false_for_regular_user(regular_user):
    response = client.get("/api/v1/admin/me", headers=login_as(client, regular_user))
    assert response.status_code == 200
    assert response.json() == {"is_admin": False}


def test_admin_me_returns_401_for_anonymous():
    response = client.get("/api/v1/admin/me")
    assert response.status_code == 401


_ADMIN_ROUTES = sorted(
    (method, route.path)
    for route in app.routes
    if isinstance(route, APIRoute)
    and route.path.startswith("/api/v1/admin/")
    and route.path != "/api/v1/admin/me"
    for method in route.methods
)


@pytest.mark.parametrize(
    ("method", "path"), _ADMIN_ROUTES, ids=[f"{m} {p}" for m, p in _ADMIN_ROUTES]
)
def test_every_admin_route_refuses_a_regular_user(regular_user, method, path):
    url = re.sub(r"\{[^}]+\}", str(uuid.UUID(int=0)), path)
    response = client.request(method, url, headers=login_as(client, regular_user))
    assert response.status_code == 403, response.text


@pytest.mark.parametrize(
    ("method", "path", "code"),
    [
        ("POST", "/api/v1/admin/invite-codes/{id}/revoke", None),
        ("DELETE", "/api/v1/admin/invite-codes/{id}", None),
        ("DELETE", "/api/v1/admin/users/{id}/detected-events", None),
        ("POST", "/api/v1/admin/users/{id}/restore", None),
        ("DELETE", "/api/v1/admin/users/{id}", "user_not_found"),
        ("DELETE", "/api/v1/admin/events/{id}", "event_not_found"),
    ],
)
def test_admin_routes_404_on_an_unknown_id(admin_user, method, path, code):
    url = path.format(id=uuid.uuid4())
    response = client.request(method, url, headers=login_as(client, admin_user))
    assert response.status_code == 404
    if code is not None:
        assert response.json()["detail"]["code"] == code


def test_create_invite_code_persists_and_returns_active(admin_user, db):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"expires_in_days": 7},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    body = response.json()
    # Codes are single-use: each names exactly one analyst.
    assert body["status"] == "active"
    assert body["expires_at"] is not None
    assert body["redeemer"] is None
    assert body["x_handle"] is None

    invite = db.query(InviteCode).filter(InviteCode.id == uuid.UUID(body["id"])).first()
    assert invite is not None
    assert invite.code == body["code"]


def test_create_invite_code_writes_admin_event(admin_user, db):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    invite_id = uuid.UUID(response.json()["id"])

    event = audit_row(db, admin_user, "invite_created")
    assert event.target == {"invite_code_id": str(invite_id)}


def test_create_invite_code_binds_x_handle_stripped_and_lowercased(admin_user, db):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"x_handle": "@Invited_Analyst"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["x_handle"] == "invited_analyst"

    invite = db.query(InviteCode).filter(InviteCode.id == uuid.UUID(body["id"])).first()
    assert invite is not None
    assert invite.x_handle == "invited_analyst"

    event = audit_row(db, admin_user, "invite_created")
    assert event.target == {"invite_code_id": body["id"], "x_handle": "invited_analyst"}


def test_create_invite_code_409_when_x_handle_already_linked(admin_user, regular_user, db):
    regular_user.x_handle = f"taken{uuid.uuid4().hex[:8]}"
    db.commit()
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"x_handle": regular_user.x_handle},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "x_handle_conflict",
        "message": "x_handle is already linked to another account",
    }


def test_create_invite_code_422_on_invalid_x_handle(admin_user):
    response = client.post(
        "/api/v1/admin/invite-codes",
        json={"x_handle": "not a handle!"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 422
    [error] = response.json()["detail"]
    assert error["loc"][-1] == "x_handle"
    assert error["msg"] == "Value error, 15 characters at most: letters, digits and _"


def test_list_invite_codes_includes_status(admin_user):
    create_response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    code = create_response.json()["code"]

    list_response = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user))
    assert list_response.status_code == 200
    rows = list_response.json()
    matching = [r for r in rows if r["code"] == code]
    assert len(matching) == 1
    assert matching[0]["status"] == "active"


def test_list_invite_codes_pages_on_a_cursor(admin_user):
    """The append-only invite table is read a bounded page at a time."""
    headers = login_as(client, admin_user)
    created = set()
    for _ in range(3):
        created.add(
            client.post("/api/v1/admin/invite-codes", json={}, headers=headers).json()["id"]
        )

    first = client.get("/api/v1/admin/invite-codes?limit=2", headers=headers)
    assert first.status_code == 200
    assert len(first.json()) == 2
    link = first.headers["Link"]
    assert link.endswith('; rel="next"')

    second = client.get(link[1 : link.index(">")].replace("http://testserver", ""), headers=headers)
    assert second.status_code == 200
    walked = [row["id"] for row in first.json()] + [row["id"] for row in second.json()]
    assert len(walked) == len(set(walked)), "a row was served twice"
    assert created <= set(walked)


def test_list_invite_codes_rejects_garbage_paging(admin_user):
    headers = login_as(client, admin_user)
    for query in ("limit=0", "limit=abc", "cursor=garbage"):
        response = client.get(f"/api/v1/admin/invite-codes?{query}", headers=headers)
        assert response.status_code == 422, f"expected 422 for {query!r}"


def test_revoke_invite_code_marks_revoked(admin_user):
    create_response = client.post(
        "/api/v1/admin/invite-codes",
        json={},
        headers=login_as(client, admin_user),
    )
    invite_id = create_response.json()["id"]

    revoke_response = client.post(
        f"/api/v1/admin/invite-codes/{invite_id}/revoke",
        headers=login_as(client, admin_user),
    )
    assert revoke_response.status_code == 200
    body = revoke_response.json()
    assert body["status"] == "revoked"


@pytest.mark.parametrize("revoked", [False, True], ids=["unused", "revoked-but-unused"])
def test_delete_invite_code_drops_an_unused_row(admin_user, db, revoked):
    headers = login_as(client, admin_user)
    created = client.post("/api/v1/admin/invite-codes", json={}, headers=headers).json()
    invite_id = uuid.UUID(created["id"])
    if revoked:
        client.post(f"/api/v1/admin/invite-codes/{invite_id}/revoke", headers=headers)

    response = client.delete(f"/api/v1/admin/invite-codes/{invite_id}", headers=headers)

    assert response.status_code == 204
    assert response.content == b""
    db.expire_all()
    assert db.query(InviteCode).filter(InviteCode.id == invite_id).first() is None


def test_delete_invite_code_writes_admin_event_carrying_the_code(admin_user, db):
    headers = login_as(client, admin_user)
    created = client.post("/api/v1/admin/invite-codes", json={}, headers=headers).json()

    client.delete(f"/api/v1/admin/invite-codes/{created['id']}", headers=headers)

    db.expire_all()
    event = audit_row(db, admin_user, "invite_deleted")
    assert event.target == {"invite_code_id": created["id"], "code": created["code"]}


def test_delete_invite_code_409_when_redeemed(admin_user, regular_user, db):
    invite_id = _redeem(db, regular_user).id
    response = client.delete(
        f"/api/v1/admin/invite-codes/{invite_id}",
        headers=login_as(client, admin_user),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "invite_code_used"
    db.expire_all()
    assert db.query(InviteCode).filter(InviteCode.id == invite_id).first() is not None


def test_list_invite_codes_carries_redeemer_onboarding_stats(admin_user, regular_user, db):
    handle = f"redeem{uuid.uuid4().hex[:8]}"
    regular_user.x_handle = handle
    invite = _redeem(db, regular_user)
    job = ArchiveImportJob(
        owner_id=regular_user.id, zip_key=f"staging/{uuid.uuid4().hex}.zip", status="done"
    )
    mention = BotMention(
        mention_post_id=uuid.uuid4().int >> 66,
        author_x_handle=handle.upper(),
        status="done",
        outcome="created",
        created_event_count=3,
    )
    login_event = AuditLog(actor_id=regular_user.id, action=ACTION_LOGIN)
    db.add_all([job, mention, login_event])
    db.commit()
    make_event(db, author=regular_user, status=STATUS_DETECTED)
    make_event(db, author=regular_user)
    try:
        rows = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user)).json()
        row = next(r for r in rows if r["code"] == invite.code)
        redeemer = row["redeemer"]
        assert redeemer["username"] == regular_user.username
        assert redeemer["x_handle"] == handle
        assert redeemer["archives_imported"] == 1
        # Case-insensitive handle match.
        assert redeemer["bot_detection_count"] == 3
        assert redeemer["detected_count"] == 1
        assert redeemer["geolocated_count"] == 1
        # ``last_seen_at`` is NULL for a user with no authenticated request: the read falls back to the login event.
        assert regular_user.last_seen_at is None
        assert redeemer["last_seen_at"] is not None
    finally:
        db.expire_all()
        db.query(BotMention).filter(BotMention.id == mention.id).delete()
        db.commit()


def _redeem(db, user: User) -> InviteCode:
    """Bind a fresh invite code to ``user`` so the onboarding list carries them."""
    invite = InviteCode(
        code=f"code{uuid.uuid4().hex[:12]}",
        used_by_id=user.id,
        used_at=datetime.now(UTC),
    )
    db.add(invite)
    db.commit()
    return invite


def _stored_last_seen(db, user: User) -> datetime | None:
    """``users.last_seen_at`` re-read from the row, not from a stale identity map."""
    db.expire_all()
    return db.query(User.last_seen_at).filter(User.id == user.id).scalar()


def test_authenticated_request_stamps_last_seen_and_the_onboarding_row_reads_it(
    admin_user, regular_user, db
):
    invite = _redeem(db, regular_user)
    assert client.get("/api/v1/auth/me", headers=login_as(client, regular_user)).status_code == 200
    stamped = _stored_last_seen(db, regular_user)
    assert stamped is not None
    client.cookies.clear()

    rows = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user)).json()
    row = next(r for r in rows if r["code"] == invite.code)
    assert datetime.fromisoformat(row["redeemer"]["last_seen_at"]) == stamped


def test_last_seen_is_rewritten_once_per_throttle_window(regular_user, db):
    """A second request inside the window costs no UPDATE; one past it stamps again."""
    headers = login_as(client, regular_user)
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    first = _stored_last_seen(db, regular_user)
    assert first is not None

    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert _stored_last_seen(db, regular_user) == first

    # Age the stored value past the window; the next request has to move it.
    stale = datetime.now(UTC) - LAST_SEEN_THROTTLE - timedelta(minutes=1)
    db.query(User).filter(User.id == regular_user.id).update({User.last_seen_at: stale})
    db.commit()
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    refreshed = _stored_last_seen(db, regular_user)
    assert refreshed is not None and refreshed > stale


def test_onboarding_row_falls_back_to_the_newest_login_event_when_last_seen_is_null(
    admin_user, regular_user, db
):
    """A row predating the column carries no stamp, so the auth log stands in."""
    invite = _redeem(db, regular_user)
    now = datetime.now(UTC)
    older = AuditLog(
        actor_id=regular_user.id, action=ACTION_LOGIN, created_at=now - timedelta(days=3)
    )
    newest = AuditLog(
        actor_id=regular_user.id, action=ACTION_LOGIN, created_at=now - timedelta(days=1)
    )
    db.add_all([older, newest])
    db.commit()
    assert _stored_last_seen(db, regular_user) is None
    rows = client.get("/api/v1/admin/invite-codes", headers=login_as(client, admin_user)).json()
    row = next(r for r in rows if r["code"] == invite.code)
    assert datetime.fromisoformat(row["redeemer"]["last_seen_at"]) == newest.created_at


def test_purge_detected_events_sweeps_detections_and_keeps_the_rest(admin_user, regular_user, db):
    detected_id = make_event(
        db, author=regular_user, status=STATUS_DETECTED, lat=None, lng=None, source_url=None
    ).id
    geolocated_id = make_event(db, author=regular_user, source_url=None).id

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}/detected-events",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == regular_user.username
    assert body["deleted_events"] == 1

    db.expire_all()
    assert db.query(Event).filter(Event.id == detected_id).first() is None
    assert db.query(Event).filter(Event.id == geolocated_id).first() is not None
    assert db.query(User).filter(User.id == regular_user.id).first() is not None

    audit = audit_row(db, admin_user, "detected_events_purged")
    assert audit.target["deleted_events"] == 1


def test_login_auto_promotes_when_email_matches_admin_emails(monkeypatch, db, live_user):
    monkeypatch.setattr(settings, "admin_emails", live_user.email)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": live_user.email, "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 200

    db.expire_all()
    promoted = db.query(User).filter(User.id == live_user.id).first()
    assert promoted is not None
    assert promoted.is_admin is True


def test_search_users_returns_matches_for_admin(admin_user, regular_user):
    response = client.get(
        f"/api/v1/admin/users?q={regular_user.username[:6]}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    rows = response.json()
    assert any(r["id"] == str(regular_user.id) for r in rows)
    target = next(r for r in rows if r["id"] == str(regular_user.id))
    assert target["email"] == regular_user.email


@pytest.mark.parametrize("q", ["%", "_"])
def test_search_users_treats_like_wildcards_literally(admin_user, regular_user, q):
    response = client.get(
        "/api/v1/admin/users", params={"q": q}, headers=login_as(client, admin_user)
    )
    assert response.status_code == 200
    assert all(q in r["username"] or q in r["email"] for r in response.json())


def test_search_users_returns_empty_for_blank_query(admin_user):
    response = client.get("/api/v1/admin/users?q=", headers=login_as(client, admin_user))
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize(
    ("raw", "handle"), [("@OSINT_Hawk", "osint_hawk"), ("plain_handle", "plain_handle")]
)
def test_set_x_handle_normalizes_and_writes_audit(admin_user, regular_user, db, raw, handle):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": raw},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert response.json()["x_handle"] == handle

    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.x_handle == handle

    event = audit_row(db, admin_user, "x_handle_linked")
    assert event.target == {"user_id": str(regular_user.id), "x_handle": handle}


def test_clear_x_handle_with_null(admin_user, regular_user, db):
    client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": "to_clear"},
        headers=login_as(client, admin_user),
    )
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": None},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert response.json()["x_handle"] is None

    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.x_handle is None

    event = audit_row(db, admin_user, "x_handle_cleared")
    assert event.target == {"user_id": str(regular_user.id)}


def test_set_x_handle_409_when_linked_to_another_user(admin_user, regular_user, make_user, db):
    held_handle = make_user("holder", x_handle=f"held{uuid.uuid4().hex[:8]}").x_handle
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": held_handle},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 409
    assert response.json()["detail"] == {
        "code": "x_handle_conflict",
        "message": "x_handle is already linked to another account",
    }
    db.expire_all()
    refreshed = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed.x_handle is None


@pytest.mark.parametrize(
    "bad_handle",
    ["", "@", "with space", "hyphen-ated", "waytoolonghandle1", "@@double", "émoji"],
)
def test_set_x_handle_422_on_invalid_handle(admin_user, regular_user, bad_handle):
    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": bad_handle},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 422


def test_set_x_handle_404_for_soft_deleted_user(admin_user, regular_user, db):
    regular_user.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.patch(
        f"/api/v1/admin/users/{regular_user.id}/x-handle",
        json={"x_handle": "some_handle"},
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 404


LOCAL = "http://localhost:8000/local-storage"


def _media(key: str, kind: str = "image") -> Media:
    return Media(sha256=fake_sha256(), storage_url=f"{LOCAL}/{key}", kind=kind)


def _copy_holder(db, owner: User, key: str) -> None:
    """An event of ``owner`` whose source copies the stored object at ``key``."""
    make_event(db, author=owner, sources=[source("https://example.com/source", media=_media(key))])


def _swept(monkeypatch) -> list[str]:
    """The storage keys the admin sweeps hand to ``sweep_keys``, in call order."""
    swept: list[str] = []
    monkeypatch.setattr(
        "app.services.admin.sweep_keys",
        lambda keys, *, context: swept.extend(keys),
    )
    monkeypatch.setattr(
        "app.services.evidence_intake.sweep_keys",
        lambda keys, *, context: swept.extend(keys),
    )
    return swept


@pytest.fixture
def geolocation(db, regular_user):
    return make_event(db, author=regular_user, kind="unknown")


def test_soft_delete_geolocation_stamps_once_and_writes_one_admin_event(
    admin_user, geolocation, db
):
    """A second call keeps the first stamp and writes no second audit row."""
    geo_id, title = geolocation.id, geolocation.title
    headers = login_as(client, admin_user)
    first = client.delete(f"/api/v1/admin/events/{geo_id}", headers=headers)
    assert first.status_code == 200
    body = first.json()
    assert body["mode"] == "soft"
    assert body["deleted_at"] is not None
    assert body["geolocation_id"] == str(geo_id)

    db.expire_all()
    refreshed = db.query(Event).filter(Event.id == geo_id).first()
    assert refreshed is not None
    assert refreshed.deleted_at is not None

    second = client.delete(f"/api/v1/admin/events/{geo_id}", headers=headers)
    assert second.status_code == 200
    assert second.json()["deleted_at"] == body["deleted_at"]

    event = audit_row(db, admin_user, "geolocation_soft_deleted")
    assert event.target == {"geolocation_id": str(geo_id), "title": title}


def test_soft_deleted_row_hidden_from_author_count(admin_user, regular_user, geolocation):
    before = client.get(f"/api/v1/users/{regular_user.username}").json()
    assert before["geolocations_count"] >= 1

    client.delete(
        f"/api/v1/admin/events/{geolocation.id}",
        headers=login_as(client, admin_user),
    )

    after = client.get(f"/api/v1/users/{regular_user.username}").json()
    assert after["geolocations_count"] == before["geolocations_count"] - 1


def test_hard_delete_drops_row_and_writes_event(admin_user, geolocation, db):
    # Capture before the API removes the row (a refresh after deletion raises ObjectDeletedError).
    geo_id = geolocation.id
    geo_title = geolocation.title

    response = client.delete(
        f"/api/v1/admin/events/{geo_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "hard"
    assert body["deleted_at"] is None
    assert body["geolocation_id"] == str(geo_id)
    assert body["title"] == geo_title

    db.expire_all()
    assert db.query(Event).filter(Event.id == geo_id).first() is None

    event = audit_row(db, admin_user, "geolocation_hard_deleted")
    assert event.target["geolocation_id"] == str(geo_id)


def test_hard_delete_sweeps_image_derivatives(admin_user, geolocation, db, monkeypatch):
    """GDPR erasure leaves nothing on S3: every image's ``_hero`` / ``_thumb`` keys reach the
    sweep too, a proof image's included."""
    geo_id = geolocation.id
    stem = uuid.uuid4().hex
    geolocation.sources[0].media = _media(f"uploads/{stem}.png")
    geolocation.media = [_media(f"proof_images/{stem}.jpg")]
    db.commit()
    swept = _swept(monkeypatch)

    response = client.delete(
        f"/api/v1/admin/events/{geo_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200

    assert set(swept) == {
        f"uploads/{stem}.png",
        f"uploads/{stem}_hero.jpg",
        f"uploads/{stem}_thumb.jpg",
        f"proof_images/{stem}.jpg",
        f"proof_images/{stem}_hero.jpg",
        f"proof_images/{stem}_thumb.jpg",
    }


def test_hard_delete_keeps_a_file_a_copy_on_another_event_names(
    admin_user, geolocation, second_user, db, monkeypatch
):
    """A source copied onto another event shares the stored object: erasing one event drops its
    media row and leaves the object to the copy."""
    key = f"uploads/{uuid.uuid4().hex}.jpg"
    geolocation.sources[0].media = _media(key)
    _copy_holder(db, second_user, key)
    swept = _swept(monkeypatch)

    response = client.delete(
        f"/api/v1/admin/events/{geolocation.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert swept == []
    db.expire_all()
    assert db.query(Media).filter(Media.storage_url == f"{LOCAL}/{key}").count() == 1


def test_hard_delete_user_sweeps_source_image_derivatives(
    admin_user, regular_user, db, monkeypatch
):
    """Same derivative coverage on user-level erasure."""
    request_id = _seed_request(db, regular_user)
    swept = _swept(monkeypatch)

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200

    assert set(swept) == {
        f"uploads/{request_id}.jpg",
        f"uploads/{request_id}_hero.jpg",
        f"uploads/{request_id}_thumb.jpg",
    }
    assert response.json()["media_count"] == 1


def test_hard_delete_user_sweeps_their_staged_uploads(admin_user, regular_user, db, monkeypatch):
    """A file the account staged and no event took yet is erased with it."""
    key = f"uploads/{uuid.uuid4().hex}.mp4"
    db.add(
        Upload(
            uploader_id=regular_user.id,
            storage_key=key,
            kind="video",
            sha256=fake_sha256(),
            expires_at=datetime.now(UTC) + UPLOAD_TTL,
        )
    )
    db.commit()
    swept = _swept(monkeypatch)

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200

    assert swept == [key]
    db.expire_all()
    assert db.query(Upload).filter(Upload.storage_key == key).count() == 0


def test_hard_delete_user_keeps_a_file_a_copy_on_another_event_names(
    admin_user, regular_user, second_user, db, monkeypatch
):
    """The erasure drops the account's events, but an object a copy on someone else's event
    still names stays in storage."""
    request_id = _seed_request(db, regular_user)
    key = f"uploads/{request_id}.jpg"
    _copy_holder(db, second_user, key)
    swept = _swept(monkeypatch)

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert swept == []
    db.expire_all()
    assert db.query(Event).filter(Event.id == request_id).first() is None
    assert db.query(Media).filter(Media.storage_url == f"{LOCAL}/{key}").count() == 1


def test_hard_delete_user_sweeps_their_avatar(admin_user, regular_user, db):
    """The profile picture is personal data: it is erased with the account, not left addressable."""
    storage = storage_module.get_storage()
    key = f"avatars/{regular_user.id}/{uuid.uuid4()}.jpg"
    store_bytes(TINY_JPEG, key)
    stored = stored_path(key)
    assert stored.is_file()

    regular_user.avatar_url = storage.public_url(key)
    db.commit()

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    assert not stored.exists()


def test_soft_delete_user_marks_deleted_at_and_cascades_geos(
    admin_user, regular_user, geolocation, db
):
    regular_user.x_handle = f"freed{uuid.uuid4().hex[:8]}"
    db.commit()

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "soft"
    assert body["deleted_at"] is not None
    assert body["cascaded_geolocations"] >= 1

    db.expire_all()
    refreshed_user = db.query(User).filter(User.id == regular_user.id).first()
    assert refreshed_user.deleted_at is not None
    # The handle is released with the tombstone (the UNIQUE spans tombstoned rows and PATCH refuses them).
    assert refreshed_user.x_handle is None
    refreshed_geo = db.query(Event).filter(Event.id == geolocation.id).first()
    assert refreshed_geo.deleted_at is not None


def test_soft_delete_user_writes_admin_event(admin_user, regular_user, db):
    client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    event = audit_row(db, admin_user, "user_soft_deleted")
    assert event.target["user_id"] == str(regular_user.id)
    assert event.target["username"] == regular_user.username


def test_restore_user_revives_the_account_and_the_events_its_soft_delete_hid(
    admin_user, regular_user, geolocation, db
):
    """An event soft-deleted on its own carries another stamp and stays deleted."""
    earlier = make_event(db, author=regular_user, source_url=None)
    earlier.deleted_at = datetime.now(UTC) - timedelta(days=1)
    db.commit()
    headers = login_as(client, admin_user)
    client.delete(f"/api/v1/admin/users/{regular_user.id}", headers=headers)

    response = client.post(f"/api/v1/admin/users/{regular_user.id}/restore", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "user_id": str(regular_user.id),
        "username": regular_user.username,
        "restored_events": 1,
    }

    db.expire_all()
    assert db.get(User, regular_user.id).deleted_at is None
    assert db.get(Event, geolocation.id).deleted_at is None
    assert db.get(Event, earlier.id).deleted_at is not None
    assert client.get(f"/api/v1/users/{regular_user.username}").status_code == 200
    audit = audit_row(db, admin_user, "user_restored")
    assert audit.target["restored_events"] == 1


def test_restore_user_is_a_no_op_on_a_live_account(admin_user, regular_user, db):
    response = client.post(
        f"/api/v1/admin/users/{regular_user.id}/restore", headers=login_as(client, admin_user)
    )
    assert response.status_code == 200, response.text
    assert response.json()["restored_events"] == 0
    assert audit_row(db, admin_user, "user_restored") is None


def test_list_invite_codes_marks_a_soft_deleted_redeemer(admin_user, regular_user, db):
    invite = _redeem(db, regular_user)
    headers = login_as(client, admin_user)
    deleted = client.delete(f"/api/v1/admin/users/{regular_user.id}", headers=headers).json()
    rows = client.get("/api/v1/admin/invite-codes", headers=headers).json()
    row = next(r for r in rows if r["code"] == invite.code)
    assert row["redeemer"]["deleted_at"] == deleted["deleted_at"]


def test_hard_delete_user_drops_row_and_geolocations(admin_user, regular_user, geolocation, db):
    """GDPR erasure takes the user's events, requests included; their media cascade via the
    source FK, and the S3 sweep after commit is counted in ``media_count``."""
    user_id = regular_user.id
    geo_id = geolocation.id
    request_id = _seed_request(db, regular_user)
    media_id = (
        db.query(Media.id)
        .join(Source, Source.id == Media.source_id)
        .filter(Source.event_id == request_id)
        .scalar()
    )

    response = client.delete(
        f"/api/v1/admin/users/{user_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "hard"
    assert body["deleted_at"] is None
    assert body["cascaded_geolocations"] >= 2
    assert body["media_count"] >= 1

    db.expire_all()
    assert db.query(User).filter(User.id == user_id).first() is None
    assert db.query(Event).filter(Event.id.in_([geo_id, request_id])).first() is None
    assert db.query(Media).filter(Media.id == media_id).first() is None

    event = audit_row(db, admin_user, "user_hard_deleted")
    assert event.target["user_id"] == str(user_id)


def _fulfilled(db, fulfiller: User, requester: User) -> uuid.UUID:
    """A request ``requester`` opened and ``fulfiller`` geolocated, ownership transferred."""
    event = make_event(db, author=fulfiller, kind="unknown")
    event.requested_by_id = requester.id
    db.commit()
    return event.id


def test_hard_delete_user_who_requested_a_fulfilled_event(
    admin_user, regular_user, second_user, db
):
    """Regression: hard-erasing a requester whose request another user fulfilled succeeds; ``requested_by_id`` is ON DELETE SET NULL and the attribution is nulled instead of 500ing."""
    event_id = _fulfilled(db, second_user, regular_user)
    fulfiller_id = second_user.id
    requester_id = regular_user.id

    response = client.delete(
        f"/api/v1/admin/users/{requester_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.query(User).filter(User.id == requester_id).first() is None
    surviving = db.query(Event).filter(Event.id == event_id).one()
    assert surviving.owner_id == fulfiller_id
    assert surviving.requested_by_id is None


def test_soft_delete_user_hides_requested_by_from_reads(admin_user, regular_user, second_user, db):
    """Regression: soft-deleting a requester whose request another user fulfilled must not leak the banned account in ``requested_by`` of the live event; the read path nulls it."""
    event_id = _fulfilled(db, second_user, regular_user)

    before = client.get(f"/api/v1/events/{event_id}")
    assert before.status_code == 200
    assert before.json()["requested_by"]["username"] == regular_user.username

    client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )

    after = client.get(f"/api/v1/events/{event_id}")
    assert after.status_code == 200
    assert after.json()["requested_by"] is None


def test_hard_delete_user_preserves_invite_codes(admin_user, make_user, db):
    """Hard-deleting a user nulls their FK on ``invite_codes`` instead of cascading: the codes are platform audit trail, not the user's personal data."""
    user = make_user("audit")
    user_id = user.id

    invite = InviteCode(code=f"audit-code-{uuid.uuid4().hex}", used_by_id=user_id)
    db.add(invite)
    db.commit()
    invite_id = invite.id

    response = client.delete(
        f"/api/v1/admin/users/{user_id}?hard=true",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200

    db.expire_all()
    assert db.query(User).filter(User.id == user_id).first() is None
    surviving = db.query(InviteCode).filter(InviteCode.id == invite_id).first()
    assert surviving is not None
    assert surviving.used_by_id is None

    db.delete(surviving)
    db.commit()


def test_search_users_excludes_soft_deleted(admin_user, regular_user, db):
    # Soft-delete directly, independent of the admin DELETE endpoint.
    regular_user.deleted_at = datetime.now(UTC)
    db.commit()

    response = client.get(
        f"/api/v1/admin/users?q={regular_user.username}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    rows = response.json()
    assert all(r["id"] != str(regular_user.id) for r in rows)


def test_login_runs_bcrypt_for_unknown_email(monkeypatch):
    # The unknown-email branch must still pay one bcrypt, else a missing user answers measurably
    # faster than a wrong password (timing oracle). Assert verify_password was called.
    calls: list[tuple[str, str]] = []

    from app.routers import auth as auth_router

    real_verify = auth_router.verify_password

    def tracking_verify(plain: str, hashed: str) -> bool:
        calls.append((plain, hashed))
        return real_verify(plain, hashed)

    monkeypatch.setattr(auth_router, "verify_password", tracking_verify)

    fresh = TestClient(app)
    response = fresh.post(
        "/api/v1/auth/login",
        json={"email": f"nobody-{uuid.uuid4().hex}@example.com", "password": "whatever"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"
    assert len(calls) == 1
    assert calls[0][1] == auth_router.DUMMY_PASSWORD_HASH


def test_login_runs_bcrypt_for_soft_deleted_user(monkeypatch, admin_user, regular_user):
    calls: list[tuple[str, str]] = []

    from app.routers import auth as auth_router

    real_verify = auth_router.verify_password

    def tracking_verify(plain: str, hashed: str) -> bool:
        calls.append((plain, hashed))
        return real_verify(plain, hashed)

    monkeypatch.setattr(auth_router, "verify_password", tracking_verify)

    fresh = TestClient(app)
    fresh.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(fresh, admin_user),
    )
    fresh.cookies.clear()
    # Right and wrong password against a soft-deleted user both return the same opaque 401
    # and both pay one bcrypt against the dummy hash.
    for password in ("password123", "wrong-password"):
        response = fresh.post(
            "/api/v1/auth/login",
            json={"email": regular_user.email, "password": password},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid email or password"

    assert len(calls) == 2
    for _, hashed in calls:
        assert hashed == auth_router.DUMMY_PASSWORD_HASH


def test_create_unguarded_invite_code_route_is_gone(regular_user):
    response = client.post(
        "/api/v1/auth/invite-codes",
        headers=login_as(client, regular_user),
    )
    assert response.status_code == 404


def _seed_request(db, author: User) -> uuid.UUID:
    """A ``requested`` event with no location and one source image at ``uploads/<id>.jpg``."""
    request = make_event(
        db, author=author, status=STATUS_REQUESTED, lat=None, lng=None, kind="unknown"
    )
    request.requested_by_id = author.id
    request.sources[0].media = _media(f"uploads/{request.id}.jpg")
    db.commit()
    return request.id


def test_soft_delete_user_cascades_to_requested_events(admin_user, regular_user, db):
    """Banning a user hides their requested events from public reads like their geolocations; one ``cascaded_geolocations`` count covers both."""
    request_id = _seed_request(db, regular_user)

    response = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "soft"
    # One requested event flipped.
    assert body["cascaded_geolocations"] >= 1

    db.expire_all()
    cascaded = db.query(Event).filter(Event.id == request_id).one()
    assert cascaded.deleted_at is not None
    listing = client.get("/api/v1/events?view=requested").json()
    assert all(row["id"] != str(request_id) for row in listing)


def test_soft_delete_user_cascade_count_is_idempotent(admin_user, regular_user, db):
    """Re-soft-deleting a soft-deleted user returns 0 cascades: the audit log records only what this call flipped."""
    _seed_request(db, regular_user)

    first = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    second = client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["deleted_at"] == second.json()["deleted_at"]
    assert first.json()["cascaded_geolocations"] >= 1
    assert second.json()["cascaded_geolocations"] == 0


def test_soft_delete_user_writes_cascade_count_in_admin_event(admin_user, regular_user, db):
    """The audit row carries the cascade count (requested events included in ``cascaded_geolocations``)."""
    _seed_request(db, regular_user)

    client.delete(
        f"/api/v1/admin/users/{regular_user.id}",
        headers=login_as(client, admin_user),
    )
    event = audit_row(db, admin_user, "user_soft_deleted")
    assert event.target["cascaded_geolocations"] >= 1


def _detection_stats(admin_user):
    response = client.get(
        "/api/v1/admin/detection-stats",
        headers=login_as(client, admin_user),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_detection_stats_401_for_anonymous():
    response = client.get("/api/v1/admin/detection-stats")
    assert response.status_code == 401


_STATS = (
    "machine_total",
    "machine_rejected",
    "pending",
    "pending_missing_source_media",
    "pending_missing_proof_image",
    "pending_missing_source_url",
)
_FILED = "https://example.com/source"


def _stats_row(
    db,
    author: User,
    *,
    machine: bool = True,
    requested: bool = False,
    via: str | None = None,
    sources: tuple[tuple[str | None, str, bool], ...] = (),
    proof: tuple[str, ...] = (),
    **kw,
) -> None:
    """One event for the stats: ``machine`` gives it a detection row, ``requested`` the request
    stamp a bot-opened request keeps for life, ``sources`` its ``(url, level, has file)``
    sources and ``proof`` the kinds of its proof media; ``kw`` are :func:`make_event`
    overrides."""
    stem = uuid.uuid4().hex
    event = make_event(
        db,
        author=author,
        detected_from_url=f"https://x.com/a/{stem}" if machine else None,
        sources=[
            source(url, level=level, media=_media(f"x/{stem}-{i}.jpg") if filed else None)
            for i, (url, level, filed) in enumerate(sources)
        ],
        **kw,
    )
    if requested:
        event.requested_at = datetime.now(UTC)
    if via is not None:
        event.detection.via = via
    event.media = [_media(f"x/{stem}-p{i}", kind=kind) for i, kind in enumerate(proof)]
    db.commit()


_CLOSED_REQUEST = {"status": STATUS_CLOSED, "before_closed_status": STATUS_REQUESTED}


@pytest.mark.parametrize(
    ("rows", "delta"),
    [
        pytest.param(
            [
                {"status": STATUS_CLOSED, "before_closed_status": STATUS_DETECTED},
                {"status": STATUS_GEOLOCATED},
                {"status": STATUS_DETECTED},
            ],
            {
                "machine_total": 3,
                "machine_rejected": 1,
                "pending": 1,
                "pending_missing_source_media": 1,
                "pending_missing_proof_image": 1,
                "pending_missing_source_url": 1,
            },
            id="a-closed-detection-is-a-reject-a-geolocated-or-pending-one-is-not",
        ),
        pytest.param(
            [{**_CLOSED_REQUEST, "machine": False, "requested": True}],
            {},
            id="a-human-submit-moves-nothing-even-closed",
        ),
        pytest.param(
            [
                {
                    **_CLOSED_REQUEST,
                    "requested": True,
                    "via": "bot",
                    "sources": (("https://t.me/example_channel/351", "direct", False),),
                },
                {
                    "status": STATUS_GEOLOCATED,
                    "requested": True,
                    "via": "bot",
                    "sources": (("https://t.me/example_channel/352", "direct", False),),
                },
            ],
            {},
            id="a-bot-opened-request-stays-out-of-the-cohort",
        ),
        pytest.param(
            [
                {"status": STATUS_DETECTED},
                {
                    "status": STATUS_DETECTED,
                    "sources": ((_FILED, "direct", True),),
                    "proof": ("image",),
                },
            ],
            {
                "machine_total": 2,
                "pending": 2,
                "pending_missing_source_media": 1,
                "pending_missing_proof_image": 1,
                "pending_missing_source_url": 1,
            },
            id="pending-flags-each-missing-piece-a-complete-one-lifts-only-pending",
        ),
        pytest.param(
            [
                {
                    "status": STATUS_DETECTED,
                    "sources": (("https://example.com/c", "context", True),),
                    "proof": ("image",),
                },
                {
                    "status": STATUS_DETECTED,
                    "sources": (
                        (None, "indirect", True),
                        ("https://example.com/i", "context", False),
                    ),
                    "proof": ("image",),
                },
            ],
            {"machine_total": 2, "pending": 2, "pending_missing_source_media": 1},
            id="source-media-counts-direct-and-indirect-sources-only",
        ),
        pytest.param(
            [{"status": STATUS_DETECTED, "deleted": True}],
            {"machine_total": 1, "machine_rejected": 1},
            id="a-soft-deleted-detection-is-a-reject-and-leaves-the-pending-queue",
        ),
        pytest.param(
            [{"status": STATUS_GEOLOCATED, "deleted": True}],
            {"machine_total": 1},
            id="a-soft-deleted-geolocated-row-is-not-a-reject",
        ),
        pytest.param(
            [
                {
                    "status": STATUS_DETECTED,
                    "sources": ((_FILED, "direct", True),),
                    "proof": ("video",),
                }
            ],
            {"machine_total": 1, "pending": 1, "pending_missing_proof_image": 1},
            id="a-proof-video-is-no-proof-image",
        ),
    ],
)
def test_detection_stats_move_by(admin_user, regular_user, db, rows, delta):
    """The reject rate is over machine detections (a detection row and no request stamp); the
    pending counts are over the live ``detected`` queue."""
    before = _detection_stats(admin_user)
    for row in rows:
        _stats_row(db, regular_user, **row)
    after = _detection_stats(admin_user)

    assert {key: after[key] - before[key] for key in _STATS} == {
        key: delta.get(key, 0) for key in _STATS
    }
    if after["machine_total"]:
        assert abs(after["reject_rate"] - after["machine_rejected"] / after["machine_total"]) < 1e-9
