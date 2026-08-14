"""Aggregate an analyst's live events into the profile stats payload.

Pure read-side queries over existing columns (no new model, no migration):
status split, media count, top conflicts, capture-source breakdown, and a
zero-filled activity row spanning the analyst's own event dates. Every query
filters visible rows only (``deleted_at IS NULL AND hidden_at IS NULL``),
matching the rest of the public read surface.
"""

import uuid
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.conflict import Conflict, event_conflicts
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    Event,
)
from app.models.media import Media
from app.models.tag import Tag, event_tags
from app.schemas.user import ActivityBucket, ActivityGranularity, TagCount, UserStatsRead
from app.services.event_filters import visible_events

# The activity row paints one bar per bucket inside the profile card, so the
# bucket count is what the layout caps, not the period. 24 bars still read at
# roughly 7 px each at 375 px, the narrowest width the profile renders at, so
# 24 is the ceiling and the bucket size steps up whenever the span exceeds it.
MAX_ACTIVITY_BUCKETS = 24

# Postgres ``to_char`` patterns, one per granularity. The quarter pattern
# quotes its literal ``Q`` so the output reads ``2024-Q3``.
PERIOD_FORMATS: dict[ActivityGranularity, str] = {
    "month": "YYYY-MM",
    "quarter": 'YYYY-"Q"Q',
    "year": "YYYY",
}

# The profile shows the head of each distribution, not the full tail.
TOP_N = 5


def _pick_granularity(span_months: int) -> ActivityGranularity:
    """The largest-resolution bucket whose count fits the row.

    Months up to a 2-year span (24 buckets), then quarters up to a 6-year one
    (24 buckets again), then years.
    """
    if span_months <= MAX_ACTIVITY_BUCKETS:
        return "month"
    # Ceiling division: a span ending mid-quarter still needs that quarter.
    if -(-span_months // 3) <= MAX_ACTIVITY_BUCKETS:
        return "quarter"
    return "year"


def _period_keys(earliest: date, latest: date, granularity: ActivityGranularity) -> list[str]:
    """Every bucket key from ``earliest`` to ``latest`` inclusive, oldest first.

    Counting in periods since year 0 keeps the wrap-around arithmetic
    branch-free.
    """
    if granularity == "year":
        return [f"{year:04d}" for year in range(earliest.year, latest.year + 1)]
    if granularity == "quarter":
        start = earliest.year * 4 + (earliest.month - 1) // 3
        end = latest.year * 4 + (latest.month - 1) // 3
        return [f"{i // 4:04d}-Q{i % 4 + 1}" for i in range(start, end + 1)]
    start = earliest.year * 12 + earliest.month - 1
    end = latest.year * 12 + latest.month - 1
    return [f"{i // 12:04d}-{i % 12 + 1:02d}" for i in range(start, end + 1)]


def get_user_stats(db: Session, *, user_id: uuid.UUID) -> UserStatsRead:
    live = (Event.owner_id == user_id, *visible_events())

    status_rows = (
        db.query(Event.status, func.count(Event.id)).filter(*live).group_by(Event.status).all()
    )
    by_status: dict[str, int] = {status_value: count for status_value, count in status_rows}
    geolocated = by_status.get(STATUS_GEOLOCATED, 0)
    detected = by_status.get(STATUS_DETECTED, 0)
    closed = by_status.get(STATUS_CLOSED, 0)

    media_count = (
        db.query(func.count(Media.id))
        .join(Event, Media.event_id == Event.id)
        .filter(*live)
        .scalar()
        or 0
    )

    conflict_rows = (
        db.query(Conflict.name, func.count(Event.id).label("cnt"))
        .join(event_conflicts, event_conflicts.c.conflict_id == Conflict.id)
        .join(Event, Event.id == event_conflicts.c.event_id)
        .filter(*live)
        .group_by(Conflict.name)
        .order_by(func.count(Event.id).desc(), Conflict.name)
        .limit(TOP_N)
        .all()
    )

    capture_rows = (
        db.query(Tag.name, func.count(Event.id).label("cnt"))
        .join(event_tags, event_tags.c.tag_id == Tag.id)
        .join(Event, Event.id == event_tags.c.event_id)
        .filter(*live, Tag.category == "capture_source")
        .group_by(Tag.name)
        .order_by(func.count(Event.id).desc(), Tag.name)
        .limit(TOP_N)
        .all()
    )

    # The window is the analyst's own coverage, not a window off today: an
    # archive spanning years is the shape the product asks for, and a fixed
    # recent window would drop most of it off the left edge.
    dated = (*live, Event.event_date.isnot(None))
    earliest, latest = (
        db.query(func.min(Event.event_date), func.max(Event.event_date)).filter(*dated).one()
    )

    granularity: ActivityGranularity = "month"
    periods: list[str] = []
    if earliest is not None and latest is not None:
        span_months = (latest.year - earliest.year) * 12 + latest.month - earliest.month + 1
        granularity = _pick_granularity(span_months)
        # The clamp only bites past 24 years of yearly buckets, where the row
        # keeps the recent end rather than shrinking every bar.
        periods = _period_keys(earliest, latest, granularity)[-MAX_ACTIVITY_BUCKETS:]

    by_period: dict[str, int] = {}
    if periods:
        period_col = func.to_char(Event.event_date, PERIOD_FORMATS[granularity])
        by_period = dict(
            db.query(period_col, func.count(Event.id)).filter(*dated).group_by(period_col).all()
        )

    return UserStatsRead(
        geolocated_count=geolocated,
        detected_count=detected,
        closed_count=closed,
        total_events=geolocated + detected + closed,
        media_count=media_count,
        top_conflicts=[TagCount(name=name, count=count) for name, count in conflict_rows],
        capture_sources=[TagCount(name=name, count=count) for name, count in capture_rows],
        activity_granularity=granularity,
        activity=[ActivityBucket(period=p, count=by_period.get(p, 0)) for p in periods],
    )
