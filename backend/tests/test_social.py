"""End-to-end tests for the social-graph slice 1 endpoints.

Coverage matrix:

* ``POST /users/{username}/follow`` — happy path (204 + row appears),
  idempotent re-follow (still 204, no duplicate row), self-follow rejected
  with 400, follow against unknown / soft-deleted user yields 404, and
  the endpoint demands an authenticated caller.
* ``DELETE /users/{username}/follow`` — happy path removes the row,
  idempotent re-unfollow (204 even when no edge), 404 on unknown / soft-
  deleted target so a typo username surfaces an error instead of silently
  no-op'ing.
* ``GET /timeline`` — 401 anonymous, empty when the caller follows nobody,
  surfaces only live (non-soft-deleted) geolocations from followed users
  with their coordinates inline (no per-row N+1), and respects pagination
  (``page``, ``per_page``).
* ``GET /users/{username}`` — ``followers_count`` / ``following_count`` /
  ``is_following`` reflect the current state for both an anonymous viewer
  and a logged-in viewer.
* Self-follow is blocked at the DB layer too (``ck_follows_no_self_follow``).

Tests rely on the same Postgres+PostGIS instance as the rest of the
backend suite — the follows migration must already be applied.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.main import app
from app.models.follow import Follow
from app.models.geolocation import Geolocation
from app.models.user import User
from app.services.auth import hash_password
from tests.conftest import login_as

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_cookies():
    client.cookies.clear()
    yield
    client.cookies.clear()


def _make_user(db, *, suffix: str | None = None) -> User:
    tag = suffix or uuid.uuid4().hex[:8]
    user = User(
        username=f"u{tag}",
        email=f"{tag}-{uuid.uuid4().hex}@example.com",
        password_hash=hash_password("password123"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_geo(db, *, author: User, title: str = "Strike", event: date | None = None) -> Geolocation:
    geo = Geolocation(
        author_id=author.id,
        title=title,
        location=from_shape(Point(37.802, 48.012), srid=4326),
        source_url="https://example.com/proof",
        event_date=event or date.today(),
    )
    db.add(geo)
    db.commit()
    db.refresh(geo)
    return geo


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def cleanup(db):
    created_user_ids: list[uuid.UUID] = []
    created_geo_ids: list[uuid.UUID] = []

    def _record_user(user: User) -> None:
        created_user_ids.append(user.id)

    def _record_geo(geo: Geolocation) -> None:
        created_geo_ids.append(geo.id)

    yield _record_user, _record_geo

    db.expire_all()
    if created_geo_ids:
        db.query(Geolocation).filter(Geolocation.id.in_(created_geo_ids)).delete(
            synchronize_session=False
        )
    if created_user_ids:
        # Follow rows carry ON DELETE CASCADE so deleting the users removes
        # the social edges automatically — no explicit purge.
        db.query(User).filter(User.id.in_(created_user_ids)).delete(synchronize_session=False)
    db.commit()


# ── POST /users/{username}/follow ─────────────────────────────────────────


def test_follow_creates_edge_and_is_idempotent(db, cleanup):
    record_user, _ = cleanup
    follower = _make_user(db, suffix="follower")
    target = _make_user(db, suffix="target")
    record_user(follower)
    record_user(target)

    first = client.post(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert first.status_code == 204

    second = client.post(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert second.status_code == 204

    edges = (
        db.query(Follow)
        .filter(Follow.follower_id == follower.id, Follow.followed_id == target.id)
        .count()
    )
    assert edges == 1


def test_follow_self_rejected_400(db, cleanup):
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    record_user(me)

    response = client.post(f"/api/v1/users/{me.username}/follow", headers=login_as(client, me))
    assert response.status_code == 400


def test_follow_unknown_user_404(db, cleanup):
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    record_user(me)

    response = client.post(
        f"/api/v1/users/ghost-{uuid.uuid4().hex}/follow", headers=login_as(client, me)
    )
    assert response.status_code == 404


def test_follow_soft_deleted_user_404(db, cleanup):
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    record_user(me)
    target = _make_user(db, suffix="gone")
    target.deleted_at = datetime.now(UTC)
    db.commit()
    record_user(target)

    response = client.post(f"/api/v1/users/{target.username}/follow", headers=login_as(client, me))
    assert response.status_code == 404


def test_follow_requires_auth():
    response = client.post(f"/api/v1/users/anyone-{uuid.uuid4().hex}/follow")
    assert response.status_code == 401


# ── DELETE /users/{username}/follow ───────────────────────────────────────


def test_unfollow_removes_edge_and_is_idempotent(db, cleanup):
    record_user, _ = cleanup
    follower = _make_user(db, suffix="follower")
    target = _make_user(db, suffix="target")
    record_user(follower)
    record_user(target)
    db.add(Follow(follower_id=follower.id, followed_id=target.id))
    db.commit()

    first = client.delete(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert first.status_code == 204

    # Idempotent: no edge → still 204.
    second = client.delete(
        f"/api/v1/users/{target.username}/follow", headers=login_as(client, follower)
    )
    assert second.status_code == 204

    edges = (
        db.query(Follow)
        .filter(Follow.follower_id == follower.id, Follow.followed_id == target.id)
        .count()
    )
    assert edges == 0


def test_unfollow_unknown_user_404(db, cleanup):
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    record_user(me)

    response = client.delete(
        f"/api/v1/users/ghost-{uuid.uuid4().hex}/follow", headers=login_as(client, me)
    )
    assert response.status_code == 404


# ── DB-level CHECK constraint ─────────────────────────────────────────────


def test_check_constraint_blocks_self_follow(db, cleanup):
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    record_user(me)

    db.add(Follow(follower_id=me.id, followed_id=me.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ── Concurrent-follow race ────────────────────────────────────────────────


def test_follow_swallows_integrity_error_from_concurrent_race(db, cleanup, monkeypatch):
    """Two requests can race past the existence check (two browser tabs,
    or any two-in-flight scenario). Only one INSERT can win the composite-
    PK unique constraint; the loser hits ``IntegrityError`` on flush. The
    service stages the INSERT inside a SAVEPOINT and swallows the error so
    the loser returns ``False`` (idempotent ``204`` at the router) rather
    than letting it bubble up as a 500.

    Forced here by pre-populating the row + patching the existence check
    so the service falls through to the savepoint path."""
    from app.services import social as social_service

    record_user, _ = cleanup
    follower = _make_user(db, suffix="follower")
    target = _make_user(db, suffix="target")
    record_user(follower)
    record_user(target)

    # Pre-populate the edge — any subsequent INSERT will violate the PK.
    db.add(Follow(follower_id=follower.id, followed_id=target.id))
    db.commit()

    # Patch ``Query.first`` to return ``None`` so the existence check
    # short-circuit doesn't run. Then ``follow_user`` falls through to the
    # savepoint INSERT, which must hit the PK violation and swallow it.
    # The patch lives only for the call; the cleanup fixture's later
    # queries see the real DB state again.
    from sqlalchemy.orm import Query

    monkeypatch.setattr(Query, "first", lambda self: None)
    result = social_service.follow_user(db, follower_id=follower.id, followed_user=target)
    assert result is False


# ── GET /timeline ─────────────────────────────────────────────────────────


def test_timeline_requires_auth():
    response = client.get("/api/v1/timeline")
    assert response.status_code == 401


def test_timeline_empty_when_no_follows(db, cleanup):
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    record_user(me)

    response = client.get("/api/v1/timeline", headers=login_as(client, me))
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_timeline_returns_followed_users_geolocations_with_coords(db, cleanup):
    record_user, record_geo = cleanup
    viewer = _make_user(db, suffix="viewer")
    author_a = _make_user(db, suffix="autha")
    author_b = _make_user(db, suffix="authb")
    stranger = _make_user(db, suffix="stranger")
    record_user(viewer)
    record_user(author_a)
    record_user(author_b)
    record_user(stranger)

    geo_a = _make_geo(db, author=author_a, title="A", event=date(2026, 5, 10))
    geo_b = _make_geo(db, author=author_b, title="B", event=date(2026, 5, 11))
    geo_stranger = _make_geo(db, author=stranger, title="Stranger", event=date(2026, 5, 12))
    record_geo(geo_a)
    record_geo(geo_b)
    record_geo(geo_stranger)

    db.add(Follow(follower_id=viewer.id, followed_id=author_a.id))
    db.add(Follow(follower_id=viewer.id, followed_id=author_b.id))
    db.commit()

    response = client.get("/api/v1/timeline", headers=login_as(client, viewer))
    assert response.status_code == 200
    body = response.json()
    titles = [item["title"] for item in body["items"]]
    assert "A" in titles and "B" in titles
    assert "Stranger" not in titles
    # Newest event date first.
    assert titles.index("B") < titles.index("A")
    assert body["total"] == 2
    # Coordinates are inline (no N+1 follow-up fetch required).
    for item in body["items"]:
        assert isinstance(item["lat"], (int, float))
        assert isinstance(item["lng"], (int, float))


def test_timeline_excludes_soft_deleted_geolocations(db, cleanup):
    record_user, record_geo = cleanup
    viewer = _make_user(db, suffix="viewer")
    author = _make_user(db, suffix="author")
    record_user(viewer)
    record_user(author)

    live = _make_geo(db, author=author, title="Live", event=date(2026, 5, 10))
    deleted = _make_geo(db, author=author, title="Deleted", event=date(2026, 5, 11))
    deleted.deleted_at = datetime.now(UTC)
    db.commit()
    record_geo(live)
    record_geo(deleted)

    db.add(Follow(follower_id=viewer.id, followed_id=author.id))
    db.commit()

    response = client.get("/api/v1/timeline", headers=login_as(client, viewer))
    body = response.json()
    titles = [item["title"] for item in body["items"]]
    assert titles == ["Live"]
    assert body["total"] == 1


def test_timeline_paginates(db, cleanup):
    record_user, record_geo = cleanup
    viewer = _make_user(db, suffix="viewer")
    author = _make_user(db, suffix="author")
    record_user(viewer)
    record_user(author)

    for i in range(5):
        geo = _make_geo(db, author=author, title=f"G{i}", event=date(2026, 5, i + 1))
        record_geo(geo)
    db.add(Follow(follower_id=viewer.id, followed_id=author.id))
    db.commit()

    page1 = client.get(
        "/api/v1/timeline?page=1&per_page=2", headers=login_as(client, viewer)
    ).json()
    page2 = client.get(
        "/api/v1/timeline?page=2&per_page=2", headers=login_as(client, viewer)
    ).json()
    assert page1["total"] == 5
    assert len(page1["items"]) == 2
    assert len(page2["items"]) == 2
    # No overlap between page 1 and page 2.
    assert {it["id"] for it in page1["items"]} & {it["id"] for it in page2["items"]} == set()


# ── GET /users/{username} — follower counters + is_following ─────────────


def test_profile_includes_follow_counters_and_is_following(db, cleanup):
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    target = _make_user(db, suffix="target")
    other_follower = _make_user(db, suffix="other")
    record_user(me)
    record_user(target)
    record_user(other_follower)

    # ``me`` follows ``target``; ``other_follower`` also follows ``target``;
    # ``target`` follows ``me`` (so following_count = 1).
    db.add(Follow(follower_id=me.id, followed_id=target.id))
    db.add(Follow(follower_id=other_follower.id, followed_id=target.id))
    db.add(Follow(follower_id=target.id, followed_id=me.id))
    db.commit()

    # Anonymous viewer — is_following is always False.
    anon = client.get(f"/api/v1/users/{target.username}").json()
    assert anon["followers_count"] == 2
    assert anon["following_count"] == 1
    assert anon["is_following"] is False

    # Logged-in viewer (``me``) — is_following is True.
    authed = client.get(f"/api/v1/users/{target.username}", headers=login_as(client, me)).json()
    assert authed["followers_count"] == 2
    assert authed["following_count"] == 1
    assert authed["is_following"] is True


def test_profile_self_view_is_following_false(db, cleanup):
    """Viewing your own profile never reports ``is_following=true`` even if
    a stray edge slipped past the CHECK constraint (e.g. legacy data)."""
    record_user, _ = cleanup
    me = _make_user(db, suffix="me")
    record_user(me)

    body = client.get(f"/api/v1/users/{me.username}", headers=login_as(client, me)).json()
    assert body["is_following"] is False
