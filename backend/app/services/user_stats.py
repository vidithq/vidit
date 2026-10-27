"""Aggregate an analyst's live events into the profile stats payload.

One population for every field: the visible events (``deleted_at IS NULL AND
hidden_at IS NULL``) in :data:`COUNTED_STATUSES` credited to the analyst
(:func:`services.event_filters.credited_to`). No two figures on the card
describe different sets.
"""

import uuid
from collections import Counter
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.conflict import Conflict, event_conflicts
from app.models.event import STATUS_DETECTED, STATUS_GEOLOCATED, Event
from app.models.media import Media
from app.models.source import Source, SourceLink, source_order
from app.schemas.user import ActivityBucket, TagCount, UserStatsRead
from app.services.event_filters import credited_to, visible_events
from app.services.sanitize import platform_host

# Work the profile vouches for. ``requested`` (open call for help) and
# ``closed`` (duplicate, rejection, retraction) are not documented work.
COUNTED_STATUSES = (STATUS_GEOLOCATED, STATUS_DETECTED)

# One grid row per calendar year. Ten rows fit the card at 375 px (about 21 px
# per cell). Older years drop out of the grid but still count elsewhere.
MAX_ACTIVITY_YEARS = 10

# One ceiling for the conflicts, source kinds, and source hosts lists.
TOP_N = 5


def _month_keys(earliest: date, latest: date) -> list[str]:
    """Every ``YYYY-MM`` key from ``earliest`` to ``latest``, oldest first.

    Cut to the :data:`MAX_ACTIVITY_YEARS` most recent years. The late end is
    clamped to today because the write path accepts any ISO ``occurred_date``: a
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
        credited_to([user_id]),
        Event.status.in_(COUNTED_STATUSES),
        *visible_events(),
    )

    status_rows = (
        db.query(Event.status, func.count(Event.id)).filter(*live).group_by(Event.status).all()
    )
    by_status: dict[str, int] = {status_value: count for status_value, count in status_rows}
    geolocated = by_status.get(STATUS_GEOLOCATED, 0)
    detected = by_status.get(STATUS_DETECTED, 0)

    # Proof images and sources' files alike.
    media_count = (
        db.query(func.count(Media.id))
        .outerjoin(Source, Source.id == Media.source_id)
        .join(Event, Event.id == func.coalesce(Media.event_id, Source.event_id))
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

    # An event counts once per kind its sources name; ``unknown`` tells the reader nothing.
    kind_rows = (
        db.query(Source.kind, func.count(func.distinct(Event.id)).label("cnt"))
        .join(Event, Event.id == Source.event_id)
        .filter(*live, Source.kind != "unknown")
        .group_by(Source.kind)
        .order_by(func.count(func.distinct(Event.id)).desc(), Source.kind)
        .limit(TOP_N)
        .all()
    )

    # One URL per event, its first source's first link, so the hosts sum to the total. The host
    # is folded in Python (:func:`sanitize.platform_host`, the one home for the rule), before
    # the ``TOP_N`` cut, so a platform's aliases rank as one host.
    # Grouping on the URL in SQL bounds this loop by distinct links, not event count, on a
    # public endpoint.
    first_link = (
        select(Source.event_id.label("event_id"), SourceLink.url.label("url"))
        .join(SourceLink, SourceLink.source_id == Source.id)
        .distinct(Source.event_id)
        .order_by(
            Source.event_id,
            *source_order(),
            SourceLink.posted_at.asc().nulls_last(),
            SourceLink.created_at,
            SourceLink.id,
        )
        .subquery()
    )
    tally: Counter[str] = Counter()
    no_source_count = 0
    url_rows = (
        db.query(first_link.c.url, func.count(Event.id))
        .select_from(Event)
        .outerjoin(first_link, first_link.c.event_id == Event.id)
        .filter(*live)
        .group_by(first_link.c.url)
        .all()
    )
    for url, url_count in url_rows:
        host = platform_host(url) if url else None
        if host is None:
            no_source_count += url_count
        else:
            tally[host] += url_count
    ranked = sorted(tally.items(), key=lambda item: (-item[1], item[0]))
    source_hosts = ranked[:TOP_N]
    other_hosts_count = sum(count for _, count in ranked[TOP_N:])

    # The window is the analyst's own coverage, not a fixed recent window.
    dated = (*live, Event.occurred_date.isnot(None))
    earliest, latest = (
        db.query(func.min(Event.occurred_date), func.max(Event.occurred_date)).filter(*dated).one()
    )

    periods: list[str] = []
    if earliest is not None and latest is not None:
        periods = _month_keys(earliest, latest)

    by_period: dict[str, int] = {}
    if periods:
        period_col = func.to_char(Event.occurred_date, "YYYY-MM")
        by_period = dict(
            db.query(period_col, func.count(Event.id)).filter(*dated).group_by(period_col).all()
        )

    return UserStatsRead(
        geolocated_count=geolocated,
        detected_count=detected,
        total_events=geolocated + detected,
        media_count=media_count,
        top_conflicts=[TagCount(name=name, count=count) for name, count in conflict_rows],
        source_kinds=[TagCount(name=kind, count=count) for kind, count in kind_rows],
        source_hosts=[TagCount(name=host, count=count) for host, count in source_hosts],
        other_hosts_count=other_hosts_count,
        no_source_count=no_source_count,
        activity=[ActivityBucket(period=p, count=by_period.get(p, 0)) for p in periods],
    )
