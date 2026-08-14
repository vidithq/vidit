"""End-to-end tests for ``GET /users/{username}/stats``.

The profile insights aggregation. Contracts to lock in:

* An empty profile returns all zeros and an empty activity row.
* A mixed profile splits by status, counts media, and surfaces conflict +
  capture-source tallies.
* The activity row spans the analyst's own earliest and latest event date,
  zero-filled, and coarsens its bucket (month → quarter → year) at each
  threshold so the row never exceeds ``MAX_ACTIVITY_BUCKETS`` bars.
* Soft-deleted events are excluded from every aggregate, matching the rest
  of the public read surface.
* Unknown and soft-deleted usernames 404 the same way as the profile.

Fixtures are local on purpose: the events package fixtures live in its own
``conftest.py`` and importing across test packages couples the suites.
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
    """Minimal event-row factory, stamped per the lifecycle CHECKs.

    ``event_date=None`` stores NULL, which the column allows in every status
    and which the activity row has to survive.
    """
    now = datetime.now(UTC)
    geo = Event(
        owner_id=author.id,
        title=f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url="https://example.com/source",
        event_date=event_date,
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
    # No event, so no span to draw: the row is empty rather than a window of
    # zeros off today. The frontend renders a sentence for this.
    assert body["activity"] == []
    assert body["activity_granularity"] == "month"


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
    # Every row shares one date, so the span is one bucket carrying all four.
    assert body["activity"] == [{"period": _month_str(today), "count": 4}]


def test_stats_activity_spans_the_analysts_own_dates(db, live_user):
    """The row runs earliest to latest event date, zero-filled between, with
    no bucket keyed off today."""
    _make_geo(db, author=live_user, event_date=date(2025, 3, 9))
    _make_geo(db, author=live_user, event_date=date(2025, 3, 22))
    _make_geo(db, author=live_user, event_date=date(2025, 6, 1))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["activity_granularity"] == "month"
    assert body["activity"] == [
        {"period": "2025-03", "count": 2},
        {"period": "2025-04", "count": 0},
        {"period": "2025-05", "count": 0},
        {"period": "2025-06", "count": 1},
    ]


def test_stats_activity_undated_events_stay_out_of_the_row(db, live_user):
    """An event with no date has no bucket to land in, and cannot pull the
    span with it. It still counts in the status split."""
    _make_geo(db, author=live_user, event_date=None)
    _make_geo(db, author=live_user, event_date=date(2025, 3, 9))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 2
    assert body["activity"] == [{"period": "2025-03", "count": 1}]


def test_stats_activity_no_dated_events_at_all(db, live_user):
    _make_geo(db, author=live_user, event_date=None)

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 1
    assert body["activity"] == []
    assert body["activity_granularity"] == "month"


@pytest.mark.parametrize(
    ("earliest", "latest", "granularity", "buckets", "first", "last"),
    [
        # 24 months exactly: the last span the row draws month by month.
        (date(2024, 1, 15), date(2025, 12, 3), "month", 24, "2024-01", "2025-12"),
        # One month past it, so the bucket steps up to quarters.
        (date(2024, 1, 15), date(2026, 1, 3), "quarter", 9, "2024-Q1", "2026-Q1"),
        # 24 quarters exactly: the last span the row draws quarter by quarter.
        (date(2020, 1, 15), date(2025, 12, 3), "quarter", 24, "2020-Q1", "2025-Q4"),
        # One month past it, so the bucket steps up again to years.
        (date(2020, 1, 15), date(2026, 1, 3), "year", 7, "2020", "2026"),
    ],
)
def test_stats_activity_bucket_thresholds(
    db, live_user, earliest, latest, granularity, buckets, first, last
):
    """The bucket coarsens at each threshold, and the row never runs past the
    24 bars the profile card holds."""
    _make_geo(db, author=live_user, event_date=earliest)
    _make_geo(db, author=live_user, event_date=latest)

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    row = body["activity"]
    assert body["activity_granularity"] == granularity
    assert len(row) == buckets
    assert row[0] == {"period": first, "count": 1}
    assert row[-1] == {"period": last, "count": 1}


def test_stats_activity_caps_a_span_longer_than_the_row(db, live_user):
    """Past 24 yearly buckets the row keeps its recent end rather than
    shrinking every bar. The dropped events still count in the totals."""
    _make_geo(db, author=live_user, event_date=date(1990, 5, 1))
    _make_geo(db, author=live_user, event_date=date(2026, 1, 3))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    row = body["activity"]
    assert body["activity_granularity"] == "year"
    assert len(row) == 24
    assert row[0]["period"] == "2003"
    assert row[-1] == {"period": "2026", "count": 1}
    assert body["total_events"] == 2


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
    assert body["activity"] == [{"period": _month_str(date.today()), "count": 1}]


def test_stats_404_for_unknown_username():
    response = client.get(f"/api/v1/users/nobody-{uuid.uuid4().hex}/stats")
    assert response.status_code == 404


def test_stats_404_for_soft_deleted_user(soft_deleted_user):
    response = client.get(f"/api/v1/users/{soft_deleted_user.username}/stats")
    assert response.status_code == 404
