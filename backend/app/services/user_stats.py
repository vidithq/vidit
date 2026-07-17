"""Aggregate an analyst's live events into the profile stats payload.

Pure read-side queries over existing columns (no new model, no migration):
status split, media count, top conflicts, capture-source breakdown, and a
zero-filled 12-month activity row. Every query filters live rows only
(``deleted_at IS NULL``), matching the rest of the public read surface.
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
from app.schemas.user import MonthBucket, TagCount, UserStatsRead

# The activity row is a fixed-width sparkline: always this many buckets,
# newest last, zero-filled so the frontend never has to pad.
ACTIVITY_MONTHS = 12

# The profile shows the head of each distribution, not the full tail.
TOP_N = 5


def _last_months(today: date, n: int) -> list[str]:
    """The last ``n`` calendar months including ``today``'s, as ``YYYY-MM``,
    oldest first."""
    # Months since year 0 make the wrap-around arithmetic branch-free.
    ordinal = today.year * 12 + today.month - 1
    months = []
    for i in range(n - 1, -1, -1):
        m = ordinal - i
        months.append(f"{m // 12:04d}-{m % 12 + 1:02d}")
    return months


def get_user_stats(db: Session, *, user_id: uuid.UUID) -> UserStatsRead:
    live = (Event.owner_id == user_id, Event.deleted_at.is_(None))

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

    months = _last_months(date.today(), ACTIVITY_MONTHS)
    window_start = date.fromisoformat(f"{months[0]}-01")
    month_col = func.to_char(func.date_trunc("month", Event.event_date), "YYYY-MM")
    activity_rows = (
        db.query(month_col, func.count(Event.id))
        .filter(*live, Event.event_date.isnot(None), Event.event_date >= window_start)
        .group_by(month_col)
        .all()
    )
    by_month = dict(activity_rows)

    return UserStatsRead(
        geolocated_count=geolocated,
        detected_count=detected,
        closed_count=closed,
        total_events=geolocated + detected + closed,
        media_count=media_count,
        top_conflicts=[TagCount(name=name, count=count) for name, count in conflict_rows],
        capture_sources=[TagCount(name=name, count=count) for name, count in capture_rows],
        monthly_activity=[MonthBucket(month=m, count=by_month.get(m, 0)) for m in months],
    )
