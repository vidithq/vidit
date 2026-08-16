"""End-to-end tests for `/users/{username}` + `/users/{username}/events`
plus `PATCH /users/me` (self-edit of bio / avatar / links).

The public profile is the second surface (after geolocations) that
analysts will land on the day they get the invite. Contracts to lock in:

* Soft-deleted users 404, same shape as unknown — so an admin
  removal doesn't double as a "this username existed" oracle.
* The profile feed counts AND lists only the analyst's published
  geolocations: live (`deleted_at IS NULL`, `hidden_at IS NULL`) and
  `status = 'geolocated'`. The feed's own `total` and its rows must
  apply the same filter, otherwise the pager counts rows it never
  serves. `geolocations_count` on the profile payload counts the same
  set: it is what the Submitted tile prints, directly above that feed,
  so a tile counting machine drafts makes the page contradict itself.
  `GET /users/{u}/stats` is where the analyst's whole body of live work
  is reported, split by status and summed as `total_events`.
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
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
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
    status: str = STATUS_GEOLOCATED,
    before_closed_status: str | None = None,
) -> Event:
    """One event owned by ``author``, defaulting to a published geolocation.

    ``status`` / ``before_closed_status`` build the other lifecycle states.
    The per-state stamps are set to match, because the table CHECKs
    (``ck_events_closed_stamp``, ``ck_events_geolocated_stamp``,
    ``ck_events_before_closed_status``) reject a row that carries a state
    without its stamp.
    """
    now = datetime.now(UTC)
    geo = Event(
        owner_id=author.id,
        title=title or f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        source_posted_at=datetime(2026, 5, 1, 12, 0, tzinfo=UTC),
        event_date=event_date or date(2026, 5, 1),
        status=status,
        geolocated_at=now if status == STATUS_GEOLOCATED else None,
        detected_at=now if status == STATUS_DETECTED else None,
        requested_at=now if status == STATUS_REQUESTED else None,
        closed_at=now if status == STATUS_CLOSED else None,
        before_closed_status=before_closed_status,
    )
    if deleted:
        geo.deleted_at = now
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


def test_feed_count_matches_profile_count_on_published_work(db, live_user):
    """On an analyst holding published work alone, `geolocations_count`
    from `/users/{u}` and `total` from `/users/{u}/events` agree. Drift
    here is the visible symptom of someone fixing one visibility filter
    and not the other."""
    _make_geo(db, author=live_user)
    _make_geo(db, author=live_user)
    _make_geo(db, author=live_user, deleted=True)

    profile = client.get(f"/api/v1/users/{live_user.username}").json()
    feed = client.get(f"/api/v1/users/{live_user.username}/events").json()
    assert profile["geolocations_count"] == feed["total"] == 2


def test_feed_serves_published_work_only(db, live_user):
    """The portfolio carries what the analyst vouched for, and nothing
    else.

    A `detected` row is machine output they have not stood behind and a
    `closed`-off-`detected` row is one they threw out, so listing either
    as their submission misrepresents them to every visitor. A
    `requested` row is an open call for help, an ask rather than an
    answer, so it is out too. The drafts stay reachable: the owner works
    them from their detections queue, and the coverage map still plots
    them beside the published rows with a split count.
    """
    published = _make_geo(db, author=live_user, title="published")
    draft = _make_geo(db, author=live_user, title="draft", status=STATUS_DETECTED)
    rejected = _make_geo(
        db,
        author=live_user,
        title="rejected",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
    )
    request = _make_geo(db, author=live_user, title="request", status=STATUS_REQUESTED)
    removed = _make_geo(db, author=live_user, title="removed", deleted=True)

    body = client.get(f"/api/v1/users/{live_user.username}/events").json()

    assert [row["id"] for row in body["items"]] == [str(published.id)]
    excluded = {str(draft.id), str(rejected.id), str(request.id), str(removed.id)}
    assert excluded.isdisjoint({row["id"] for row in body["items"]})
    # The pager must not count rows it will never serve: a `total` of 5
    # over one served row is how a "Show more" that leads nowhere ships.
    assert body["total"] == 1


def test_profile_count_counts_published_work_only(db, live_user):
    """`geolocations_count` counts the published geolocations and nothing
    else, across the full lifecycle.

    It is the Submitted tile's number, and the tile sits above a Recent
    submissions block and a coverage split that both count published
    rows. An analyst who ran an archive import owns hundreds of machine
    drafts, so counting those here tiles a figure an order of magnitude
    above everything under it and credits them with claims they never
    made.
    """
    _make_geo(db, author=live_user, title="published")
    _make_geo(db, author=live_user, title="draft", status=STATUS_DETECTED)
    _make_geo(
        db,
        author=live_user,
        title="rejected",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
    )
    _make_geo(db, author=live_user, title="request", status=STATUS_REQUESTED)
    _make_geo(
        db,
        author=live_user,
        title="withdrawn",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_REQUESTED,
    )
    _make_geo(db, author=live_user, title="removed", deleted=True)

    profile = client.get(f"/api/v1/users/{live_user.username}").json()
    feed = client.get(f"/api/v1/users/{live_user.username}/events").json()
    assert profile["geolocations_count"] == feed["total"] == 1


def test_profile_count_and_stats_report_different_numbers(db, live_user):
    """The whole body of live work is still reported, under its own name.

    `/stats` splits by status and sums to `total_events`; the profile
    payload counts the published part. A change that collapses the two
    takes the wider figure off the profile entirely, which is what the
    Insights card and the coverage map read against.
    """
    _make_geo(db, author=live_user)
    _make_geo(db, author=live_user, status=STATUS_DETECTED)
    _make_geo(
        db,
        author=live_user,
        title="rejected",
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
    )

    profile = client.get(f"/api/v1/users/{live_user.username}").json()
    stats = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert profile["geolocations_count"] == 1
    assert stats["geolocated_count"] == 1
    assert stats["detected_count"] == 1
    assert stats["closed_count"] == 1
    assert stats["total_events"] == 3


def test_feed_orders_published_rows_newest_event_date_first(db, live_user):
    """Order is over the filtered set, not a filtered slice of a wider
    ordering: a draft dated between two published rows must not consume
    a page slot or reshuffle what survives it."""
    _make_geo(db, author=live_user, event_date=date(2025, 1, 1), title="old")
    _make_geo(db, author=live_user, event_date=date(2026, 12, 1), title="new")
    _make_geo(db, author=live_user, event_date=date(2026, 6, 1), title="mid")
    _make_geo(
        db,
        author=live_user,
        event_date=date(2026, 9, 1),
        title="draft",
        status=STATUS_DETECTED,
    )

    body = client.get(f"/api/v1/users/{live_user.username}/events?per_page=2").json()
    assert [row["title"] for row in body["items"]] == ["new", "mid"]
    assert body["total"] == 3


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
    live_user.avatar_url = "https://example.com/a.jpg"
    db.commit()

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
    """The schema is ``extra=forbid``, guarding against a future caller that
    thinks it can set an unlisted column via the self-edit endpoint."""
    response = client.patch(
        "/api/v1/users/me",
        json={"is_admin": True},
        headers=login_as(client, live_user),
    )
    assert response.status_code == 422
