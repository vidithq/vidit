"""Aggregate an analyst's live events into the profile stats payload.

Pure read-side queries over existing columns (no new model, no migration):
status split, media count, top conflicts, capture-source breakdown, the
source-host breakdown, and a zero-filled monthly row spanning the analyst's own
event dates.

One population for every field, so the card the payload feeds can state it
once: the analyst's visible events (``deleted_at IS NULL AND hidden_at IS
NULL``) in the three worked statuses, :data:`COUNTED_STATUSES`. That is the set
``total_events`` counts. A ``requested`` row is an open call for help rather
than work the analyst documented, so it is out of every aggregate here, and so
is a ``closed`` row that was withdrawn from ``requested``, which is the same
ask in its retired form. No two figures on the card describe different sets.
"""

import uuid
from collections import Counter
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.conflict import Conflict, event_conflicts
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
)
from app.models.media import Media
from app.models.tag import Tag, event_tags
from app.schemas.user import ActivityBucket, TagCount, UserStatsRead
from app.services.event_filters import visible_events
from app.services.sanitize import normalised_host

# The statuses that are documented work. The three the card splits by, and the
# three ``total_events`` sums.
COUNTED_STATUSES = (STATUS_GEOLOCATED, STATUS_DETECTED, STATUS_CLOSED)

# The activity grid draws one row per calendar year, twelve month cells wide.
# 10 rows is the ceiling: at 375 px, the narrowest width the profile renders
# at, a year label plus twelve cells leaves each cell about 21 px, and ten rows
# of them still fit the card without scrolling. A longer archive keeps its 10
# most recent years; the dropped events still count in every other aggregate,
# and the row labels say which years are on screen.
MAX_ACTIVITY_YEARS = 10

# The profile shows the head of each distribution, not the full tail. One
# ceiling for all three lists (conflicts, capture sources, source hosts), so
# the card has a single rule for how much of a tail it prints.
TOP_N = 5


def _month_keys(earliest: date, latest: date) -> list[str]:
    """Every ``YYYY-MM`` key from ``earliest`` to ``latest`` inclusive.

    Oldest first, and cut to the :data:`MAX_ACTIVITY_YEARS` most recent
    calendar years. Counting in months since year 0 keeps the wrap-around
    arithmetic branch-free.

    Both ends are clamped to today, because the write path accepts any valid
    ISO ``event_date`` and the year cap is anchored on the late end. One
    mistyped year (``2925-06-01`` for ``2025-06-01``) would otherwise open the
    window on 2916 to 2925 and drop every real event out of the grid. A span
    holding nothing but future dates has no coverage left after the clamp and
    returns an empty grid rather than a nonsense one; the events themselves
    still count in every other aggregate.
    """
    today = date.today()
    if earliest > today:
        return []
    latest = min(latest, today)
    first_year = max(earliest.year, latest.year - MAX_ACTIVITY_YEARS + 1)
    start = max(earliest.year * 12 + earliest.month - 1, first_year * 12)
    end = latest.year * 12 + latest.month - 1
    return [f"{i // 12:04d}-{i % 12 + 1:02d}" for i in range(start, end + 1)]


def get_user_stats(db: Session, *, user_id: uuid.UUID) -> UserStatsRead:
    live = (
        Event.owner_id == user_id,
        Event.status.in_(COUNTED_STATUSES),
        # ``closed`` covers two different rows. Off ``detected`` it is a
        # machine detection the analyst threw out, a judgement they made, so it is
        # documented work. Off ``requested`` it is a call for help they
        # withdrew, and a ``requested`` row takes part in no aggregate here, so
        # its retired form must not either. ``is_distinct_from`` rather than
        # ``!=``: ``before_closed_status`` is NULL on every non-closed row, and
        # ``!=`` would evaluate NULL there and drop all of them.
        Event.before_closed_status.is_distinct_from(STATUS_REQUESTED),
        *visible_events(),
    )

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

    # The host comes off the URL in Python, not in SQL, so the folding rule has
    # one home (:func:`sanitize.normalised_host`, shared with source archival)
    # rather than a second spelling in a regex. SQL still does the counting:
    # grouping on the URL hands back one row per distinct link, so this loop is
    # bounded by how many links an analyst reuses rather than by how much work
    # they have, on an endpoint anyone can call.
    tally: Counter[str] = Counter()
    no_source_count = 0
    url_rows = (
        db.query(Event.source_url, func.count(Event.id))
        .filter(*live)
        .group_by(Event.source_url)
        .all()
    )
    for url, url_count in url_rows:
        host = normalised_host(url) if url else None
        if host is None:
            no_source_count += url_count
        else:
            tally[host] += url_count
    ranked = sorted(tally.items(), key=lambda item: (-item[1], item[0]))
    source_hosts = ranked[:TOP_N]
    other_hosts_count = sum(count for _, count in ranked[TOP_N:])

    # The window is the analyst's own coverage, not a window off today: an
    # archive spanning years is the shape the product asks for, and a fixed
    # recent window would drop most of it off the left edge.
    dated = (*live, Event.event_date.isnot(None))
    earliest, latest = (
        db.query(func.min(Event.event_date), func.max(Event.event_date)).filter(*dated).one()
    )

    periods: list[str] = []
    if earliest is not None and latest is not None:
        periods = _month_keys(earliest, latest)

    by_period: dict[str, int] = {}
    if periods:
        period_col = func.to_char(Event.event_date, "YYYY-MM")
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
        source_hosts=[TagCount(name=host, count=count) for host, count in source_hosts],
        other_hosts_count=other_hosts_count,
        no_source_count=no_source_count,
        activity=[ActivityBucket(period=p, count=by_period.get(p, 0)) for p in periods],
    )
