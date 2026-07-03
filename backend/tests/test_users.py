"""End-to-end tests for `/users/{username}` + `/users/{username}/events`
plus `PATCH /users/me` (self-edit of bio / avatar / links).

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
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.event import Event
from app.models.user import User
from app.services.auth import hash_password
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
    db.query(Event).filter(Event.author_id == user_id).delete(synchronize_session=False)
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
    db.query(Event).filter(Event.author_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def trusted_user(db):
    user = User(
        username=f"trust{uuid.uuid4().hex[:8]}",
        email=f"trust-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
        is_trusted=True,
        trust_reason="Established OSINT analyst, verified track record.",
    )
    db.add(user)
    db.commit()
    user_id = user.id
    yield user
    db.expire_all()
    db.query(Event).filter(Event.author_id == user_id).delete(synchronize_session=False)
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
        author_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        location=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=event_date or date(2026, 5, 1),
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
    assert body["is_trusted"] is False
    assert body["trust_reason"] is None
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


def test_profile_surfaces_trust_signal(trusted_user):
    """The trust mark + substantiation are public — they're the credibility signal.

    Asserts the public schema carries `is_trusted` AND `trust_reason`
    together. Surfacing the flag without its reason would defeat the
    "substantiated trust" design intent.
    """
    response = client.get(f"/api/v1/users/{trusted_user.username}")
    assert response.status_code == 200
    body = response.json()
    assert body["is_trusted"] is True
    assert body["trust_reason"] == "Established OSINT analyst, verified track record."


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


def test_profile_count_excludes_soft_deleted_geos(db, live_user):
    """`geolocations_count` must filter `deleted_at IS NULL`.

    Diverging the count from the feed (next test) would surface a
    "submissions: 5" header above a feed of 3 — a confusing UX bug
    and a real signal that admin-removed evidence is leaking somewhere.
    """
    _make_geo(db, author=live_user)
    _make_geo(db, author=live_user)
    _make_geo(db, author=live_user, deleted=True)

    response = client.get(f"/api/v1/users/{live_user.username}")
    assert response.status_code == 200
    assert response.json()["geolocations_count"] == 2


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


def test_patch_me_sets_bio_and_avatar(live_user, db):
    response = client.patch(
        "/api/v1/users/me",
        json={
            "bio": "OSINT analyst, Eastern Ukraine armoured movement.",
            "avatar_url": "https://example.com/me.jpg",
        },
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["bio"] == "OSINT analyst, Eastern Ukraine armoured movement."
    assert body["avatar_url"] == "https://example.com/me.jpg"

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio == "OSINT analyst, Eastern Ukraine armoured movement."
    assert refreshed.avatar_url == "https://example.com/me.jpg"


def test_patch_me_replaces_external_links_wholesale(live_user, db):
    """JSONB column is replaced, not deep-merged. Documenting the contract.

    The edit form submits the entire panel at once; if a user clears the
    GitHub field and re-saves, the column should reflect "no github
    anymore" — not silently retain the old value because the field was
    absent. Filtering nulls in the handler is what produces a clean
    object instead of ``{"x": "@handle", "github": null, ...}``.
    """
    # Set both
    client.patch(
        "/api/v1/users/me",
        json={"external_links": {"x": "@me", "github": "@me-gh"}},
        headers=login_as(client, live_user),
    )

    # Now PATCH with only github — x should be gone
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
    # Seed
    live_user.bio = "seeded bio"
    live_user.avatar_url = "https://example.com/a.jpg"
    db.commit()

    # Patch only avatar — bio must be preserved
    response = client.patch(
        "/api/v1/users/me",
        json={"avatar_url": "https://example.com/b.jpg"},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 200

    db.expire_all()
    refreshed = db.query(User).filter(User.id == live_user.id).first()
    assert refreshed.bio == "seeded bio"
    assert refreshed.avatar_url == "https://example.com/b.jpg"


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


def test_patch_me_rejects_non_http_avatar(live_user):
    """``javascript:`` URLs would XSS the moment the avatar is rendered.

    The schema validator gates the column at write time so the badly-
    sanitised render path never has to make that decision later.
    """
    response = client.patch(
        "/api/v1/users/me",
        json={"avatar_url": "javascript:alert(1)"},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422


def test_patch_me_rejects_overlong_bio(live_user):
    response = client.patch(
        "/api/v1/users/me",
        json={"bio": "x" * 501},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422


def test_patch_me_ignores_extra_fields(live_user):
    """The schema is ``extra=forbid`` — guarding against a future caller
    that thinks it can set ``is_trusted`` via the self-edit endpoint."""
    response = client.patch(
        "/api/v1/users/me",
        json={"is_trusted": True},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422


def test_patch_me_does_not_leak_email_in_public_profile(live_user):
    """After a successful PATCH, the public profile endpoint still excludes
    the email — the self-edit path must not somehow leak it through."""
    client.patch(
        "/api/v1/users/me",
        json={"bio": "leak check"},
        headers=login_as(client, live_user),
    )
    response = client.get(f"/api/v1/users/{live_user.username}")
    assert response.status_code == 200
    assert "email" not in response.json()
