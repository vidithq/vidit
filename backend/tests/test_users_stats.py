"""End-to-end tests for ``GET /users/{username}/stats``.

The profile insights aggregation. Contracts to lock in:

* An empty profile returns all zeros and an empty activity row.
* A mixed profile splits by status, counts media, and surfaces conflict +
  capture-source tallies.
* The source-host breakdown folds ``www.``, keeps the top ``TOP_N`` hosts,
  tips the rest into ``other_hosts_count``, counts a source-less event in
  ``no_source_count``, and adds up to ``total_events``.
* The activity row spans the analyst's own earliest and latest event date, one
  bucket per month, zero-filled, cut to the ``MAX_ACTIVITY_YEARS`` most recent
  calendar years, with both ends clamped to today so a mistyped future year
  cannot push the real events out of the window.
* Every aggregate describes one population: visible events in the three
  worked statuses. Soft-deleted rows, ``requested`` calls and the withdrawn
  asks they close into take no part.
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

    ``event_date=None`` stores NULL, which the column allows in every status
    and which the activity row has to survive. ``source_url=None`` needs a
    ``detected`` or ``closed`` status: ``ck_events_source_url_status`` requires
    the column on the other two. ``before_closed_status`` only applies to a
    ``closed`` row and says which of the two closures it is, a rejected
    detection or a withdrawn ask.
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
    assert body["closed_count"] == 0
    assert body["total_events"] == 0
    assert body["media_count"] == 0
    assert body["top_conflicts"] == []
    assert body["capture_sources"] == []
    assert body["source_hosts"] == []
    assert body["other_hosts_count"] == 0
    assert body["no_source_count"] == 0
    # No event, so no span to draw: the grid is empty rather than a window of
    # zeros off today. The frontend renders a sentence for this.
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
    assert body["source_hosts"] == [{"name": "example.com", "count": 4}]
    # Every row shares one date, so the span is one bucket carrying all four.
    assert body["activity"] == [{"period": _month_str(today), "count": 4}]


def test_stats_activity_spans_the_analysts_own_dates(db, live_user):
    """The row runs earliest to latest event date, zero-filled between, with
    no bucket keyed off today."""
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


def test_stats_activity_keeps_month_granularity_over_a_long_span(db, live_user):
    """A multi-year span stays month by month: the grid gains rows, never a
    coarser cell. Five years of coverage is five rows of twelve."""
    _make_geo(db, author=live_user, event_date=date(2022, 3, 1))
    _make_geo(db, author=live_user, event_date=date(2026, 7, 4))

    row = client.get(f"/api/v1/users/{live_user.username}/stats").json()["activity"]
    assert row[0] == {"period": "2022-03", "count": 1}
    assert row[-1] == {"period": "2026-07", "count": 1}
    # March 2022 through July 2026 inclusive.
    assert len(row) == (2026 - 2022) * 12 + 7 - 3 + 1
    assert all(bucket["count"] == 0 for bucket in row[1:-1])


def test_stats_activity_caps_the_span_at_ten_calendar_years(db, live_user):
    """Past ten year rows the grid keeps its recent end rather than shrinking
    every cell, and it starts at January of the oldest year it shows. The
    dropped events still count in the totals."""
    _make_geo(db, author=live_user, event_date=date(1990, 5, 1))
    _make_geo(db, author=live_user, event_date=date(2026, 3, 3))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    row = body["activity"]
    assert row[0] == {"period": "2017-01", "count": 0}
    assert row[-1] == {"period": "2026-03", "count": 1}
    assert len(row) == 9 * 12 + 3
    assert body["total_events"] == 2


def test_stats_activity_ignores_a_future_event_date(db, live_user):
    """A date past today takes no bucket and cannot drag the window with it.

    ``event_date`` accepts any valid ISO date on the write path, and the ten
    year cap is anchored on the late end of the span, so an un-clamped typo
    (``2925`` for ``2025``) would open the grid on 2916 to 2925 and blank it.
    The mistyped row still counts in the status split, like any other event
    the grid has no cell for.
    """
    today = date.today()
    real = date(today.year - 1, 3, 1)
    _make_geo(db, author=live_user, event_date=real)
    _make_geo(db, author=live_user, event_date=date(2925, 6, 1))

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 2
    assert body["geolocated_count"] == 2
    # The window runs from the real event to today rather than out to 2925.
    # Un-clamped, the ten year cap would start it at 2916 and the real event
    # would fall off the left edge with nothing left on the grid.
    row = body["activity"]
    assert row[0] == {"period": _month_str(real), "count": 1}
    assert row[-1]["period"] == _month_str(today)
    # The mistyped row has no cell anywhere, so the grid sums to the real one.
    assert sum(bucket["count"] for bucket in row) == 1


def test_stats_activity_all_future_dates_draw_no_grid(db, live_user):
    """Nothing but future dates leaves no coverage to draw, so the grid is
    empty rather than a window on a century that has not happened."""
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
    """A ``requested`` row is an open call for help, not documented work: it
    is outside the population every figure on the card describes, so it takes
    no part in any aggregate."""
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


def test_stats_excludes_a_withdrawn_request(db, live_user, conflict, capture_source_tag):
    """Withdrawing a call for help moves no figure on the card.

    A ``closed`` row off ``requested`` is the same ask in its retired form,
    not work the analyst documented, so it stays out of the population the
    open ``requested`` row is already out of. The other closure, off
    ``detected``, is a judgement the analyst made and does count.
    """
    _make_geo(db, author=live_user, event_date=date(2025, 4, 2))
    _make_geo(
        db,
        author=live_user,
        status=STATUS_CLOSED,
        before_closed_status=STATUS_REQUESTED,
        conflicts=[conflict],
        tags=[capture_source_tag],
        with_media=True,
        event_date=date(2025, 9, 9),
        source_url="https://withdrawn.example/post",
    )

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 1
    assert body["closed_count"] == 0
    assert body["media_count"] == 0
    assert body["top_conflicts"] == []
    assert body["capture_sources"] == []
    assert body["source_hosts"] == [{"name": "example.com", "count": 1}]
    assert body["activity"] == [{"period": "2025-04", "count": 1}]


def test_stats_counts_a_rejected_detection(db, live_user):
    """The other half of the ``closed`` split: a thrown-out machine detection is
    documented work and keeps its place in the tally."""
    _make_geo(
        db,
        author=live_user,
        status=STATUS_CLOSED,
        before_closed_status=STATUS_DETECTED,
        event_date=date(2025, 4, 2),
    )

    body = client.get(f"/api/v1/users/{live_user.username}/stats").json()
    assert body["total_events"] == 1
    assert body["closed_count"] == 1
    assert body["activity"] == [{"period": "2025-04", "count": 1}]


# ── Source hosts ──────────────────────────────────────────────────────────


def test_stats_source_hosts_fold_www_and_rank_by_count(db, live_user):
    """One platform is one entry: the host is lower-cased and a leading
    ``www.`` comes off, so ``www.tiktok.com`` and ``tiktok.com`` do not split
    the same beat across two segments. Ties break on the host name."""
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
    """The named segments stop at ``TOP_N``; the sixth host and everything
    after it lands in ``other_hosts_count``. Pinned at the boundary: five
    hosts name themselves, six do not."""
    # Descending counts, so the ranking is unambiguous: 6, 5, 4, 3, 2, 1.
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
    """A machine detection whose post declared no source, and a stored value no
    host can be read from, both land in ``no_source_count`` rather than
    vanishing: the breakdown adds up to ``total_events``."""
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
