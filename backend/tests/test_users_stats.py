"""End-to-end tests for ``GET /users/{username}/stats``.

The profile insights aggregation. Contracts to lock in:

* An empty profile returns all zeros and a full 12-bucket zero-filled
  activity row (the frontend renders a fixed-width bar row, never pads).
* A mixed profile splits by status, counts media, and surfaces conflict +
  capture-source tallies.
* Soft-deleted events are excluded from every aggregate, matching the rest
  of the public read surface.
* Unknown and soft-deleted usernames 404 the same way as the profile.

Fixtures are local on purpose: the events package fixtures live in its own
``conftest.py`` and importing across test packages couples the suites.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.database import SessionLocal
from app.main import app
from app.models.conflict import Conflict
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    Event,
)
from app.models.media import Media
from app.models.tag import Tag
from app.models.user import User
from app.services.auth import hash_password

client = TestClient(app)


def _month_str(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


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
        username=f"stat{uuid.uuid4().hex[:8]}",
        email=f"stat-{uuid.uuid4().hex}@example.com",
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
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def conflict(db):
    row = Conflict(name=f"conflict-{uuid.uuid4().hex[:8]}", ongoing=True, source="manual")
    db.add(row)
    db.commit()
    conflict_id = row.id
    yield row
    db.execute(Conflict.__table__.delete().where(Conflict.id == conflict_id))
    db.commit()


@pytest.fixture
def capture_source_tag(db):
    tag = Tag(name=f"capture-{uuid.uuid4().hex[:8]}", category="capture_source")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(Tag.__table__.delete().where(Tag.id == tag_id))
    db.commit()


@pytest.fixture
def free_tag(db):
    tag = Tag(name=f"tag-{uuid.uuid4().hex[:8]}", category="free")
    db.add(tag)
    db.commit()
    tag_id = tag.id
    yield tag
    db.execute(Tag.__table__.delete().where(Tag.id == tag_id))
    db.commit()


def _make_geo(
    db,
    *,
    author: User,
    status: str = STATUS_GEOLOCATED,
    event_date: date | None = None,
    deleted: bool = False,
    tags: list[Tag] | None = None,
    conflicts: list[Conflict] | None = None,
    with_media: bool = False,
) -> Event:
    """Minimal event-row factory, stamped per the lifecycle CHECKs."""
    now = datetime.now(UTC)
    geo = Event(
        owner_id=author.id,
        title=f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        event_date=event_date if event_date is not None else date.today(),
        status=status,
    )
    if status == STATUS_GEOLOCATED:
        geo.geolocated_at = now
    elif status == STATUS_DETECTED:
        geo.detected_at = now
    elif status == STATUS_CLOSED:
        geo.closed_at = now
        geo.before_closed_status = "detected"
    if deleted:
        geo.deleted_at = now
    if tags:
        geo.tags = tags
    if conflicts:
        geo.conflicts = conflicts
    db.add(geo)
    db.flush()
    if with_media:
        db.add(
            Media(event_id=geo.id, role="source", storage_url="s3://x/m.jpg", media_type="image")
        )
    db.commit()
    db.refresh(geo)
    return geo


# ── Tests ─────────────────────────────────────────────────────────────────


def test_stats_empty_profile_all_zeros(live_user):
    response = client.get(f"/api/v1/users/{live_user.username}/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["geolocated_count"] == 0
    assert body["detected_count"] == 0
    assert body["closed_count"] == 0
    assert body["total_events"] == 0
    assert body["media_count"] == 0
    assert body["top_conflicts"] == []
    assert body["capture_sources"] == []
    # Fixed-width contract: always 12 buckets, zero-filled, current month last.
    months = body["monthly_activity"]
    assert len(months) == 12
    assert all(bucket["count"] == 0 for bucket in months)
    assert months[-1]["month"] == _month_str(date.today())


def test_stats_mixed_profile(db, live_user, conflict, capture_source_tag, free_tag):
    today = date.today()
    _make_geo(
        db,
        author=live_user,
        conflicts=[conflict],
        tags=[capture_source_tag, free_tag],
        with_media=True,
        event_date=today,
    )
    _make_geo(db, author=live_user, conflicts=[conflict], with_media=True, event_date=today)
    _make_geo(db, author=live_user, status=STATUS_DETECTED, event_date=today)
    _make_geo(db, author=live_user, status=STATUS_CLOSED, event_date=today)

    response = client.get(f"/api/v1/users/{live_user.username}/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["geolocated_count"] == 2
    assert body["detected_count"] == 1
    assert body["closed_count"] == 1
    assert body["total_events"] == 4
    assert body["media_count"] == 2
    assert body["top_conflicts"] == [{"name": conflict.name, "count": 2}]
    # The free-category tag must not leak into the capture-source breakdown.
    assert body["capture_sources"] == [{"name": capture_source_tag.name, "count": 1}]
    current = next(
        bucket for bucket in body["monthly_activity"] if bucket["month"] == _month_str(today)
    )
    assert current["count"] == 4


def test_stats_monthly_buckets_window(db, live_user):
    """Events land in their own month bucket; anything older than the
    12-month window is excluded from the row (but still counted in totals)."""
    today = date.today()
    # ~3 months back, clamped to day 1 so the arithmetic can't skip a month.
    three_back = (today.replace(day=1) - timedelta(days=80)).replace(day=1)
    ancient = today.replace(year=today.year - 2)
    _make_geo(db, author=live_user, event_date=today)
    _make_geo(db, author=live_user, event_date=three_back)
    _make_geo(db, author=live_user, event_date=ancient)

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    by_month = {bucket["month"]: bucket["count"] for bucket in body["monthly_activity"]}
    assert len(by_month) == 12
    assert by_month[_month_str(today)] == 1
    assert by_month[_month_str(three_back)] == 1
    assert _month_str(ancient) not in by_month
    assert body["total_events"] == 3


def test_stats_excludes_soft_deleted_events(db, live_user, conflict, capture_source_tag):
    _make_geo(db, author=live_user, event_date=date.today())
    _make_geo(
        db,
        author=live_user,
        conflicts=[conflict],
        tags=[capture_source_tag],
        with_media=True,
        deleted=True,
        event_date=date.today(),
    )

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["geolocated_count"] == 1
    assert body["total_events"] == 1
    assert body["media_count"] == 0
    assert body["top_conflicts"] == []
    assert body["capture_sources"] == []
    current = next(
        bucket for bucket in body["monthly_activity"] if bucket["month"] == _month_str(date.today())
    )
    assert current["count"] == 1


def test_stats_404_for_unknown_username():
    response = client.get(f"/api/v1/users/nobody-{uuid.uuid4().hex}/stats")
    assert response.status_code == 404


def test_stats_404_for_soft_deleted_user(soft_deleted_user):
    response = client.get(f"/api/v1/users/{soft_deleted_user.username}/stats")
    assert response.status_code == 404
