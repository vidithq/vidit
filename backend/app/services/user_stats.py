"""Aggregate an analyst's live events into the profile stats payload.

One population for every field: the analyst's visible events (``deleted_at IS
NULL AND hidden_at IS NULL``) in :data:`COUNTED_STATUSES`. No two figures on
the card describe different sets.
"""

import uuid
from collections import Counter
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.conflict import Conflict, event_conflicts
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.media import Media
from app.models.tag import Tag, event_tags
from app.schemas.user import ActivityBucket, TagCount, UserStatsRead
from app.services.event_filters import visible_events
from app.services.sanitize import normalised_host

# Work the profile vouches for. ``requested`` (open call for help) and
# ``closed`` (duplicate, rejection, retraction) are not documented work.
COUNTED_STATUSES = (STATUS_GEOLOCATED, STATUS_DETECTED)

# One grid row per calendar year. Ten rows fit the card at 375 px (about 21 px
# per cell). Older years drop out of the grid but still count elsewhere.
MAX_ACTIVITY_YEARS = 10

# One ceiling for the conflicts, capture sources, and source hosts lists.
TOP_N = 5


def _month_keys(earliest: date, latest: date) -> list[str]:
    """Every ``YYYY-MM`` key from ``earliest`` to ``latest``, oldest first.

    Cut to the :data:`MAX_ACTIVITY_YEARS` most recent years. The late end is
    clamped to today because the write path accepts any ISO ``event_date``: a
    mistyped ``2925-06-01`` would otherwise push every real event out of the
    window. A span of only future dates returns an empty grid.
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
        *visible_events(),
    )

    status_rows = (
        db.query(Event.status, func.count(Event.id)).filter(*live).group_by(Event.status).all()
    )
    by_status: dict[str, int] = {status_value: count for status_value, count in status_rows}
    geolocated = by_status.get(STATUS_GEOLOCATED, 0)
    detected = by_status.get(STATUS_DETECTED, 0)

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

    # The host is folded in Python (:func:`sanitize.normalised_host`, the one
    # home for the rule). Grouping on the URL in SQL bounds this loop by
    # distinct links, not event count, on a public endpoint.
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

    # The window is the analyst's own coverage, not a fixed recent window.
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
        total_events=geolocated + detected,
        media_count=media_count,
        top_conflicts=[TagCount(name=name, count=count) for name, count in conflict_rows],
        capture_sources=[TagCount(name=name, count=count) for name, count in capture_rows],
        source_hosts=[TagCount(name=host, count=count) for host, count in source_hosts],
        other_hosts_count=other_hosts_count,
        no_source_count=no_source_count,
        activity=[ActivityBucket(period=p, count=by_period.get(p, 0)) for p in periods],
    )
