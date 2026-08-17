"""End-to-end tests for `/users/{username}` + `/users/{username}/events`
plus `PATCH /users/me` (self-edit of bio / links) and the avatar endpoints.

The public profile is the second surface (after geolocations) that
analysts will land on the day they get the invite. Contracts to lock in:

* Soft-deleted users 404, same shape as unknown — so an admin
  removal doesn't double as a "this username existed" oracle.
* The profile feed counts AND lists only live geolocations
  (`deleted_at IS NULL`) — both `geolocations_count` and the feed
  rows must filter, otherwise the count and the feed diverge.
* `UserProfile` carries the public profile fields (bio, avatar_url,
  external_links) but never leaks `email`.
* `PATCH /users/me` distinguishes "field omitted" from "field set to
  null/empty" — omitting preserves, null/empty clears.
* `avatar_url` is server-minted. `PUT /users/me/avatar` stores one image
  on our own media host and points the column at it, `DELETE` clears
  both, and the self-edit body cannot set it. Anything the owner could
  type there would be a URL every viewer's browser fetches, which is the
  beacon the upload pipeline closes.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.event import Event
from app.models.user import User
from app.services import storage as storage_module
from app.services.auth import hash_password
from app.services.storage import LOCAL_STORAGE_URL_PREFIX
from tests._fixtures import TINY_JPEG
from tests.conftest import login_as

client = TestClient(app)


# ── Fixtures ──────────────────────────────────────────────────────────────


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
def live_user(db):
    user = User(
        username=f"live{uuid.uuid4().hex[:8]}",
        email=f"live-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def soft_deleted_user(db):
    user = User(
        username=f"gone{uuid.uuid4().hex[:8]}",
        email=f"gone-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        deleted_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.owner_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


def _make_geo(
    db,
    *,
    author: User,
    title: str | None = None,
    event_date: date | None = None,
    deleted: bool = False,
) -> Event:
    geo = Event(
        owner_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=event_date or date(2026, 5, 1),
        geolocated_at=datetime.now(UTC),
    )
    if deleted:
        geo.deleted_at = datetime.now(UTC)
    db.add(geo)
    db.commit()
    db.refresh(geo)
    return geo


# ── GET /users/{username} — profile ───────────────────────────────────────


def test_profile_returns_user_shape(live_user):
    response = client.get(f"/api/v1/users/{live_user.username}")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(live_user.id)
    assert body["username"] == live_user.username
    assert body["bio"] is None
    assert body["avatar_url"] is None
    # Default ``{}``  — never NULL — so the frontend renders a stable shape.
    assert body["external_links"] == {}
    assert body["geolocations_count"] == 0


def test_profile_does_not_leak_email(db):
    """`UserProfile` is the public schema — email must not surface here.

    Locked in deliberately: a public profile that included the email
    would be a free harvest endpoint for anyone with the username.
    """
    user = User(
        username=f"priv{uuid.uuid4().hex[:8]}",
        email=f"private-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    try:
        response = client.get(f"/api/v1/users/{user.username}")
        assert response.status_code == 200
        body = response.json()
        assert "email" not in body, "email must not leak in public profile"
    finally:
        db.delete(user)
        db.commit()


def test_profile_404_for_unknown_username():
    response = client.get(f"/api/v1/users/nobody-{uuid.uuid4().hex}")
    assert response.status_code == 404


def test_profile_404_for_soft_deleted_user(soft_deleted_user):
    """Same surface as unknown — admin removal doesn't double as a probe.

    A 200 (with empty fields) or any distinguishable error would let
    a caller enumerate "which usernames were once registered but
    later removed by an admin." The flat 404 is what closes that.
    """
    response = client.get(f"/api/v1/users/{soft_deleted_user.username}")
    assert response.status_code == 404


# ── GET /users/{username}/events — feed ─────────────────────────────


def test_feed_returns_pagination_envelope(live_user):
    response = client.get(f"/api/v1/users/{live_user.username}/events")
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["per_page"] == 20


def test_feed_excludes_soft_deleted_geos(db, live_user):
    """The feed must filter soft-delete; otherwise the public profile
    contradicts the rest of the site (which hides admin-removed rows)
    and admin removals leak back through one specific endpoint."""
    live = _make_geo(db, author=live_user, title="live one")
    dead = _make_geo(db, author=live_user, title="removed", deleted=True)

    response = client.get(f"/api/v1/users/{live_user.username}/events")
    assert response.status_code == 200
    body = response.json()
    ids = {row["id"] for row in body["items"]}
    assert str(live.id) in ids
    assert str(dead.id) not in ids
    assert body["total"] == 1


def test_feed_count_matches_profile_count(db, live_user):
    """Symmetry property: `geolocations_count` from `/users/{u}` must
    equal `total` from `/users/{u}/events`. Drift between them
    is the visible symptom of someone fixing one filter and not the
    other."""
    _make_geo(db, author=live_user)
    _make_geo(db, author=live_user)
    _make_geo(db, author=live_user, deleted=True)

    profile = client.get(f"/api/v1/users/{live_user.username}").json()
    feed = client.get(f"/api/v1/users/{live_user.username}/events").json()
    assert profile["geolocations_count"] == feed["total"] == 2


def test_feed_orders_by_event_date_desc(db, live_user):
    """Newest event first — the analyst-most-useful default for a
    timeline. If this regresses, the public profile starts looking
    like an arbitrary dump."""
    _make_geo(db, author=live_user, event_date=date(2025, 1, 1), title="old")
    _make_geo(db, author=live_user, event_date=date(2026, 12, 1), title="new")
    _make_geo(db, author=live_user, event_date=date(2026, 6, 1), title="mid")

    response = client.get(f"/api/v1/users/{live_user.username}/events")
    items = response.json()["items"]
    titles_in_order = [row["title"] for row in items]
    assert titles_in_order.index("new") < titles_in_order.index("old")


def test_feed_caps_per_page_at_100(db, live_user):
    """Whatever the caller requests, the server caps at 100 — a
    backstop against accidental large reads (and the cheapest piece
    of anti-scraping discipline before the proper per-IP / per-user limits land)."""
    response = client.get(f"/api/v1/users/{live_user.username}/events?per_page=500")
    assert response.status_code == 200
    assert response.json()["per_page"] == 100


def test_feed_404_for_unknown_username():
    response = client.get(f"/api/v1/users/nobody-{uuid.uuid4().hex}/events")
    assert response.status_code == 404


def test_feed_404_for_soft_deleted_user(soft_deleted_user):
    response = client.get(f"/api/v1/users/{soft_deleted_user.username}/events")
    assert response.status_code == 404


# ── PATCH /users/me — self-edit ────────────────────────────────────────────


def test_patch_me_requires_auth():
    response = client.patch("/api/v1/users/me", json={"bio": "anything"})
    assert response.status_code == 401


def test_patch_me_sets_bio(live_user, db):
    response = client.patch(
        "/api/v1/users/me",
        json={"bio": "OSINT analyst, Eastern Ukraine armoured movement."},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200
    assert response.json()["bio"] == "OSINT analyst, Eastern Ukraine armoured movement."

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio == "OSINT analyst, Eastern Ukraine armoured movement."


def test_patch_me_replaces_external_links_wholesale(live_user, db):
    """JSONB column is replaced, not deep-merged. Documenting the contract.

    The edit form submits the entire panel at once; if a user clears the
    GitHub field and re-saves, the column should reflect "no github
    anymore" — not silently retain the old value because the field was
    absent. Filtering nulls in the handler is what produces a clean
    object instead of ``{"x": "@handle", "github": null, ...}``.
    """
    client.patch(
        "/api/v1/users/me",
        json={"external_links": {"x": "@me", "github": "@me-gh"}},
        headers=login_as(client, live_user),
    )

    response = client.patch(
        "/api/v1/users/me",
        json={"external_links": {"github": "@me-gh-2"}},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.external_links == {"github": "@me-gh-2"}


def test_patch_me_omitted_fields_preserved(live_user, db):
    """Omitting a field leaves the column alone — distinct from sending null."""
    live_user.bio = "seeded bio"
    live_user.external_links = {"x": "@seeded"}
    db.commit()

    response = client.patch(
        "/api/v1/users/me",
        json={"external_links": {"x": "@edited"}},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio == "seeded bio"
    assert refreshed.external_links == {"x": "@edited"}


def test_patch_me_empty_string_clears_bio(live_user, db):
    """Submitting "" clears the bio — that's the "delete and save" flow.

    Without this, a user couldn't drop their bio without an admin
    intervention. The schema strips whitespace then coerces empty → None.
    """
    live_user.bio = "seeded"
    db.commit()

    response = client.patch(
        "/api/v1/users/me",
        json={"bio": "   "},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200
    assert response.json()["bio"] is None

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio is None


def test_patch_me_cannot_set_avatar_url(live_user, db):
    """The self-edit body has no ``avatar_url``, and the schema forbids extras.

    The column is the address every viewer's browser fetches, so it may only
    hold a URL the server minted. Leaving the field writable here would keep
    the beacon the upload endpoints exist to close.
    """
    response = client.patch(
        "/api/v1/users/me",
        json={"avatar_url": "https://tracker.example.com/beacon.gif"},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url is None


def test_patch_me_rejects_overlong_bio(live_user):
    response = client.patch(
        "/api/v1/users/me",
        json={"bio": "x" * 501},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422


def test_patch_me_ignores_extra_fields(live_user):
    """The schema is ``extra=forbid``, guarding against a future caller that
    thinks it can set an unlisted column via the self-edit endpoint."""
    response = client.patch(
        "/api/v1/users/me",
        json={"is_admin": True},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422


# ── PUT / DELETE /users/me/avatar ─────────────────────────────────────────


@pytest.fixture
def local_storage(monkeypatch, tmp_path):
    """Point the storage backend at a scratch directory for one test.

    The avatar contract is "the object physically lands on our own media host,
    and the replaced one physically goes away", which only the local backend
    lets a test read back off disk.
    """
    monkeypatch.setattr(storage_module.settings, "storage_backend", "local")
    monkeypatch.setattr(storage_module.settings, "local_storage_dir", str(tmp_path))
    return tmp_path


def _stored_path(root: Path, url: str) -> Path:
    """The on-disk file a local-storage public URL resolves to."""
    return root / url.removeprefix(f"{LOCAL_STORAGE_URL_PREFIX}/")


def _put_avatar(live_user, content: bytes = TINY_JPEG, content_type: str = "image/jpeg"):
    return client.put(
        "/api/v1/users/me/avatar",
        files={"file": ("me.jpg", content, content_type)},
        headers=login_as(client, live_user),
    )


def test_put_avatar_stores_the_image_on_our_own_host(local_storage, live_user, db):
    """The minted URL is under our storage prefix, so no viewer's browser is
    sent to a host the profile owner chose."""
    response = _put_avatar(live_user)
    assert response.status_code == 200
    url = response.json()["avatar_url"]
    assert url.startswith(f"{LOCAL_STORAGE_URL_PREFIX}/avatars/{live_user.id}/")
    assert url.endswith(".jpg")
    # One object, not the hero/thumb trio the evidence pipeline writes.
    stored = _stored_path(local_storage, url)
    assert stored.is_file()
    assert list(stored.parent.iterdir()) == [stored]

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url == url


def test_put_avatar_replaces_and_removes_the_previous_object(local_storage, live_user, db):
    """A replaced picture is deleted, not left addressable: the old URL keeps
    working for anyone who saved it otherwise."""
    first_url = _put_avatar(live_user).json()["avatar_url"]
    first_path = _stored_path(local_storage, first_url)
    assert first_path.is_file()

    second_url = _put_avatar(live_user).json()["avatar_url"]
    assert second_url != first_url
    assert not first_path.exists()
    assert _stored_path(local_storage, second_url).is_file()

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url == second_url


def test_delete_avatar_clears_the_column_and_the_object(local_storage, live_user, db):
    url = _put_avatar(live_user).json()["avatar_url"]
    stored = _stored_path(local_storage, url)
    assert stored.is_file()

    response = client.delete("/api/v1/users/me/avatar", headers=login_as(client, live_user))
    assert response.status_code == 200
    assert response.json()["avatar_url"] is None
    assert not stored.exists()

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url is None


def test_delete_avatar_is_idempotent(local_storage, live_user):
    """Nothing to clear is a success, so a double-click can't 500."""
    response = client.delete("/api/v1/users/me/avatar", headers=login_as(client, live_user))
    assert response.status_code == 200
    assert response.json()["avatar_url"] is None


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b"not an image at all", "text/plain"),
        (b"\x00\x00\x00\x18ftypmp42", "video/mp4"),
    ],
)
def test_put_avatar_rejects_non_images(local_storage, live_user, db, content, content_type):
    """Only the image types the evidence pipeline accepts can become an avatar:
    a video would land unstripped and unresized."""
    response = _put_avatar(live_user, content=content, content_type=content_type)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_avatar"

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.avatar_url is None


def test_put_avatar_rejects_undecodable_image(local_storage, live_user):
    """A JPEG content type on bytes Pillow can't open is a 422, not a 500."""
    response = _put_avatar(live_user, content=b"\xff\xd8\xff\xd9", content_type="image/jpeg")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_avatar"


def test_avatar_endpoints_require_auth():
    assert (
        client.put("/api/v1/users/me/avatar", files={"file": ("me.jpg", TINY_JPEG)}).status_code
        == 401
    )
    assert client.delete("/api/v1/users/me/avatar").status_code == 401
