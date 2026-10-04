"""End-to-end tests for ``GET /users/{username}/stats``.

The profile insights aggregation:

* An empty profile returns zeros and an empty activity row.
* A mixed profile splits by status, counts media, and tallies conflicts and
  capture sources.
* The source-host breakdown folds ``www.``, keeps the top ``TOP_N`` hosts, tips
  the rest into ``other_hosts_count``, counts source-less events in
  ``no_source_count``, and adds up to ``total_events``.
* The activity row spans the analyst's earliest to latest event date, one
  zero-filled bucket per month, cut to the ``MAX_ACTIVITY_YEARS`` latest years,
  both ends clamped to today (a mistyped future year cannot push real events out).
* Every aggregate covers visible ``geolocated`` and ``detected`` events only;
  soft-deleted, ``requested`` and ``closed`` rows take no part.
* Unknown and soft-deleted usernames 404 like the profile.

Fixtures are local: importing the events package's ``conftest.py`` would couple the suites.
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
    STATUS_REQUESTED,
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
    before_closed_status: str = STATUS_DETECTED,
    event_date: date | None = None,
    source_url: str | None = "https://example.com/source",
    deleted: bool = False,
    tags: list[Tag] | None = None,
    conflicts: list[Conflict] | None = None,
    with_media: bool = False,
) -> Event:
    """Minimal event-row factory, stamped per the lifecycle CHECKs.

    ``source_url=None`` needs a ``detected`` or ``closed`` status
    (``ck_events_source_url_status``). ``before_closed_status`` applies to a
    ``closed`` row only.
    """
    now = datetime.now(UTC)
    geo = Event(
        owner_id=author.id,
        title=f"Geo {uuid.uuid4().hex[:8]}",
        event_coords=from_shape(Point(34.5, 48.5), srid=4326),
        source_url=source_url,
        event_date=event_date,
        status=status,
    )
    if status == STATUS_GEOLOCATED:
        geo.geolocated_at = now
    elif status == STATUS_DETECTED:
        geo.detected_at = now
    elif status == STATUS_CLOSED:
        geo.closed_at = now
        geo.before_closed_status = before_closed_status
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
    assert body["total_events"] == 0
    assert body["media_count"] == 0
    assert body["top_conflicts"] == []
    assert body["capture_sources"] == []
    assert body["source_hosts"] == []
    assert body["other_hosts_count"] == 0
    assert body["no_source_count"] == 0
    # No event, no span: the grid is empty, not a window of zeros.
    assert body["activity"] == []


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

    response = client.get(f"/api/v1/users/{live_user.username}/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["geolocated_count"] == 2
    assert body["detected_count"] == 1
    assert body["total_events"] == 3
    assert body["media_count"] == 2
    assert body["top_conflicts"] == [{"name": conflict.name, "count": 2}]
    assert body["capture_sources"] == [{"name": capture_source_tag.name, "count": 1}]
    assert body["source_hosts"] == [{"name": "example.com", "count": 3}]
    assert body["activity"] == [{"period": _month_str(today), "count": 3}]


def test_stats_activity_spans_the_analysts_own_dates(db, live_user):
    """The row runs earliest to latest event date, zero-filled between, with no bucket keyed off today."""
    _make_geo(db, author=live_user, event_date=date(2025, 3, 9))
    _make_geo(db, author=live_user, event_date=date(2025, 3, 22))
    _make_geo(db, author=live_user, event_date=date(2025, 6, 1))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["activity"] == [
        {"period": "2025-03", "count": 2},
        {"period": "2025-04", "count": 0},
        {"period": "2025-05", "count": 0},
        {"period": "2025-06", "count": 1},
    ]


def test_stats_activity_undated_events_stay_out_of_the_row(db, live_user):
    """A dateless event lands in no bucket and does not stretch the span, but counts in the status split."""
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


def test_stats_activity_keeps_month_granularity_over_a_long_span(db, live_user):
    """A multi-year span stays month by month: more rows, never coarser cells."""
    _make_geo(db, author=live_user, event_date=date(2022, 3, 1))
    _make_geo(db, author=live_user, event_date=date(2026, 7, 4))

    row = client.get(f"/api/v1/users/{live_user.username}/stats").json()["activity"]
    assert row[0] == {"period": "2022-03", "count": 1}
    assert row[-1] == {"period": "2026-07", "count": 1}
    assert len(row) == (2026 - 2022) * 12 + 7 - 3 + 1
    assert all(bucket["count"] == 0 for bucket in row[1:-1])


def test_stats_activity_caps_the_span_at_ten_calendar_years(db, live_user):
    """Past ten year rows the grid keeps its recent end, starting at January of the oldest
    year shown. Dropped events still count in the totals."""
    _make_geo(db, author=live_user, event_date=date(1990, 5, 1))
    _make_geo(db, author=live_user, event_date=date(2026, 3, 3))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    row = body["activity"]
    assert row[0] == {"period": "2017-01", "count": 0}
    assert row[-1] == {"period": "2026-03", "count": 1}
    assert len(row) == 9 * 12 + 3
    assert body["total_events"] == 2


def test_stats_activity_ignores_a_future_event_date(db, live_user):
    """A future date takes no bucket and cannot drag the window.

    The ten year cap anchors on the late end, so an un-clamped typo (``2925`` for
    ``2025``) would open the grid on 2916 to 2925 and blank it. The row still
    counts in the status split.
    """
    today = date.today()
    real = date(today.year - 1, 3, 1)
    _make_geo(db, author=live_user, event_date=real)
    _make_geo(db, author=live_user, event_date=date(2925, 6, 1))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 2
    assert body["geolocated_count"] == 2
    # The window runs from the real event to today, not out to 2925.
    row = body["activity"]
    assert row[0] == {"period": _month_str(real), "count": 1}
    assert row[-1]["period"] == _month_str(today)
    assert sum(bucket["count"] for bucket in row) == 1


def test_stats_activity_all_future_dates_draw_no_grid(db, live_user):
    """Only future dates leave no coverage to draw: the grid is empty."""
    _make_geo(db, author=live_user, event_date=date(2925, 6, 1))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 1
    assert body["activity"] == []


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
    assert body["source_hosts"] == [{"name": "example.com", "count": 1}]
    assert body["activity"] == [{"period": _month_str(date.today()), "count": 1}]


def test_stats_excludes_requested_calls_for_help(db, live_user, conflict, capture_source_tag):
    """A ``requested`` row is an open call, not documented work: no aggregate counts it."""
    _make_geo(db, author=live_user, event_date=date(2025, 4, 2))
    _make_geo(
        db,
        author=live_user,
        status=STATUS_REQUESTED,
        conflicts=[conflict],
        tags=[capture_source_tag],
        with_media=True,
        event_date=date(2025, 9, 9),
        source_url="https://requested.example/post",
    )

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 1
    assert body["media_count"] == 0
    assert body["top_conflicts"] == []
    assert body["capture_sources"] == []
    assert body["source_hosts"] == [{"name": "example.com", "count": 1}]
    assert body["activity"] == [{"period": "2025-04", "count": 1}]


@pytest.mark.parametrize(
    ("before_closed_status", "source_url"),
    [
        # A detection closed as a duplicate or rejected, with no source.
        (STATUS_DETECTED, None),
        (STATUS_GEOLOCATED, "https://retracted.example/post"),
        (STATUS_REQUESTED, "https://withdrawn.example/post"),
    ],
)
def test_stats_excludes_closed_rows(
    db, live_user, conflict, capture_source_tag, before_closed_status, source_url
):
    """A ``closed`` row (duplicate, rejected detection, retraction, withdrawn ask) moves no figure."""
    _make_geo(db, author=live_user, event_date=date(2025, 4, 2))
    _make_geo(
        db,
        author=live_user,
        status=STATUS_CLOSED,
        before_closed_status=before_closed_status,
        conflicts=[conflict],
        tags=[capture_source_tag],
        with_media=True,
        event_date=date(2025, 9, 9),
        source_url=source_url,
    )

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["geolocated_count"] == 1
    assert body["detected_count"] == 0
    assert body["total_events"] == 1
    assert body["media_count"] == 0
    assert body["top_conflicts"] == []
    assert body["capture_sources"] == []
    assert body["source_hosts"] == [{"name": "example.com", "count": 1}]
    assert body["other_hosts_count"] == 0
    assert body["no_source_count"] == 0
    assert body["activity"] == [{"period": "2025-04", "count": 1}]


def test_stats_counts_an_open_detection(db, live_user, conflict, capture_source_tag):
    """An open ``detected`` row stays in every aggregate, source-less included."""
    _make_geo(
        db,
        author=live_user,
        status=STATUS_DETECTED,
        conflicts=[conflict],
        tags=[capture_source_tag],
        with_media=True,
        event_date=date(2025, 4, 2),
        source_url=None,
    )

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["detected_count"] == 1
    assert body["total_events"] == 1
    assert body["media_count"] == 1
    assert body["top_conflicts"] == [{"name": conflict.name, "count": 1}]
    assert body["capture_sources"] == [{"name": capture_source_tag.name, "count": 1}]
    assert body["no_source_count"] == 1
    assert body["activity"] == [{"period": "2025-04", "count": 1}]


# ── Source hosts ──────────────────────────────────────────────────────────


def test_stats_source_hosts_fold_www_and_rank_by_count(db, live_user):
    """The host is lower-cased and a leading ``www.`` dropped, so one platform is one
    entry. Ties break on the host name."""
    for path in range(3):
        _make_geo(db, author=live_user, source_url=f"https://x.com/a/status/{path}")
    _make_geo(db, author=live_user, source_url="https://www.tiktok.com/@a/video/1")
    _make_geo(db, author=live_user, source_url="https://TikTok.com/@a/video/2")
    _make_geo(db, author=live_user, source_url="https://t.me/chan/7")

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["source_hosts"] == [
        {"name": "x.com", "count": 3},
        {"name": "tiktok.com", "count": 2},
        {"name": "t.me", "count": 1},
    ]
    assert body["other_hosts_count"] == 0
    assert body["no_source_count"] == 0


def test_stats_source_hosts_keep_five_and_tip_the_tail_into_other(db, live_user):
    """Named segments stop at ``TOP_N``; the rest land in ``other_hosts_count``
    (boundary: five hosts name themselves, six do not)."""
    # Descending counts keep the ranking unambiguous.
    for rank, count in enumerate([6, 5, 4, 3, 2, 1]):
        for i in range(count):
            _make_geo(db, author=live_user, source_url=f"https://host{rank}.example/{i}")

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert [row["name"] for row in body["source_hosts"]] == [
        "host0.example",
        "host1.example",
        "host2.example",
        "host3.example",
        "host4.example",
    ]
    assert [row["count"] for row in body["source_hosts"]] == [6, 5, 4, 3, 2]
    assert body["other_hosts_count"] == 1
    assert body["no_source_count"] == 0
    assert sum(row["count"] for row in body["source_hosts"]) + body["other_hosts_count"] == 21


def test_stats_source_hosts_count_a_source_less_detection(db, live_user):
    """A source-less detection and an unparseable stored value land in
    ``no_source_count``, so the breakdown adds up to ``total_events``."""
    _make_geo(db, author=live_user, status=STATUS_DETECTED, source_url=None)
    _make_geo(db, author=live_user, status=STATUS_DETECTED, source_url="not a url")
    _make_geo(db, author=live_user, source_url="https://x.com/a/status/1")

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["source_hosts"] == [{"name": "x.com", "count": 1}]
    assert body["other_hosts_count"] == 0
    assert body["no_source_count"] == 2
    assert (
        sum(row["count"] for row in body["source_hosts"])
        + body["other_hosts_count"]
        + body["no_source_count"]
        == body["total_events"]
    )


def test_stats_404_for_unknown_username():
    response = client.get(f"/api/v1/users/nobody-{uuid.uuid4().hex}/stats")
    assert response.status_code == 404


def test_stats_404_for_soft_deleted_user(soft_deleted_user):
    response = client.get(f"/api/v1/users/{soft_deleted_user.username}/stats")
    assert response.status_code == 404
