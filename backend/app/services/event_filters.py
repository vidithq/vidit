"""The standard event filter set, shared by every surface that lists events.

`/events`, `/events/points` and `/search` all accept the same filter
vocabulary (status / conflict / capture source / tag / dates / author /
media / trusted / demo). Single-sourcing the predicates here keeps the surfaces from
drifting; the anti-injection author pattern lives here for the same reason
(it is a security boundary).

The date / bbox / media validators raise ``HTTPException(422)`` directly:
they are the input boundary for query parameters, moved here with the
predicates so a filter and its validation can't separate.
"""

from dataclasses import dataclass, fields
from datetime import date, timedelta

from fastapi import HTTPException
from geoalchemy2.functions import ST_MakeEnvelope, ST_Within
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Query as SAQuery

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

# Reject junk at the input boundary: restrict ``?author=`` (and the suggestion
# query it is picked from) to the characters a real username carries, killing
# ``%`` / ``\`` LIKE vectors before any SQL builder. Used as a
# ``Query(pattern=...)`` guard at every endpoint that accepts either param.
AUTHOR_FILTER_PATTERN = r"^[A-Za-z0-9_-]{1,50}$"

# Accepted ``media`` filter values (the ``Media.media_type`` domain). Reject
# anything else at the boundary so a typo returns 422 instead of silently
# matching nothing — parameterized, so never an injection risk.
MEDIA_TYPES = frozenset({"image", "video"})

# Accepted ``status`` filter values (the ``Event.status`` lifecycle domain).
# Same boundary contract as ``MEDIA_TYPES``: a typo returns 422 instead of
# silently matching nothing. The predicate only narrows within the caller's
# view, so a value the view can't contain returns empty, not an error.
# Hand-kept FE mirror: ``STATUS_FILTER_OPTIONS`` in
# ``frontend/src/components/filters/EventFilterSections.tsx`` offers the
# subset the filtered read views serve (geolocated / detected); change the
# two together (see AGENTS.md).
STATUSES = frozenset({STATUS_REQUESTED, STATUS_DETECTED, STATUS_GEOLOCATED, STATUS_CLOSED})

# The two read views over the one table. ``located`` is the catalog: vouched +
# machine rows, keeping a rejected detection visible (``closed`` off
# ``detected``). ``requested`` is the open-call queue (ex ``/requests``),
# keeping a withdrawn request visible the same way.
VIEWS = frozenset({"located", "requested"})


def apply_author_filter(query: SAQuery, author: str) -> SAQuery:
    """Join the owner and match the username exactly (case-insensitive).

    Exact, not substring: the filter means "this analyst's work", and the
    surfaces pick the value from real usernames (the author typeahead, a
    profile's "Show more"), so ``?author=ana`` must not sweep in every
    handle containing "ana". Callers gate ``author`` through
    :data:`AUTHOR_FILTER_PATTERN` (a ``Query(pattern=...)``).
    """
    return query.join(Event.owner).filter(func.lower(User.username) == author.lower())


def view_predicate(view: str):
    """The status predicate for a read view (see ``VIEWS``)."""
    if view == "requested":
        return or_(
            Event.status == STATUS_REQUESTED,
            and_(
                Event.status == STATUS_CLOSED,
                Event.before_closed_status == STATUS_REQUESTED,
            ),
        )
    return or_(
        Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)),
        and_(
            Event.status == STATUS_CLOSED,
            Event.before_closed_status == STATUS_DETECTED,
        ),
    )


def validate_media_types(media: list[str] | None) -> None:
    """422 on a ``media`` value outside the ``Media.media_type`` domain."""
    if media and not set(media) <= MEDIA_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"media must be one of: {', '.join(sorted(MEDIA_TYPES))}",
        )


def validate_status_filter(status: list[str] | None) -> None:
    """422 on a ``status`` value outside the ``Event.status`` domain."""
    if status and not set(status) <= STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of: {', '.join(sorted(STATUSES))}",
        )


def parse_filter_date(value: str | None, field: str) -> date | None:
    """Validate an ISO-8601 date filter param. Returns 422 on garbage.

    Forwarding the raw string into the SQLAlchemy comparison let Postgres
    raise ``InvalidDatetimeFormat`` as a 500; on an anonymous-reachable
    endpoint a scraper could fill Sentry with those. Matches the
    ``parse_bbox`` pattern.

    Tolerates full ISO-8601 datetimes (a saved URL or older client may
    send ``2026-05-01T12:00:00Z``). The time component is stripped — this
    is a date filter — but accepting it avoids regressing working URLs
    into a 422 just because the doc shape tightened to ``YYYY-MM-DD``.
    """
    if value is None or value == "":
        return None
    try:
        # 3.11+ ``date.fromisoformat`` accepts a trailing time component;
        # the [:10] truncation is belt-and-braces against older Pythons
        # and makes the date-only intent explicit.
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be an ISO-8601 date (YYYY-MM-DD)",
        ) from exc


def parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    """Parse ``south,west,north,east`` into validated floats.

    Raises ``HTTPException(422)`` on malformed input. The previous version
    swallowed parse errors and fell back to an unfiltered query — wrong for
    a map endpoint, where a typo then returned every point on Earth. Empty
    is the right fail-safe; unbounded is not.

    Validation: four comma-separated floats, lat in [-90, 90], lng in
    [-180, 180], south <= north, west <= east. Antimeridian-crossing boxes
    (west > east) aren't handled — MapLibre viewports never produce them.
    """
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=422,
            detail="bbox must be four comma-separated numbers: south,west,north,east",
        )
    try:
        south, west, north, east = (float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="bbox must be four comma-separated numbers: south,west,north,east",
        ) from exc
    if not (-90.0 <= south <= 90.0 and -90.0 <= north <= 90.0):
        raise HTTPException(status_code=422, detail="bbox latitudes must be in [-90, 90]")
    if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
        raise HTTPException(status_code=422, detail="bbox longitudes must be in [-180, 180]")
    if south > north:
        raise HTTPException(status_code=422, detail="bbox south must be <= north")
    if west > east:
        raise HTTPException(status_code=422, detail="bbox west must be <= east")
    return south, west, north, east


def apply_filters(
    query: SAQuery,
    *,
    view: str = "located",
    status: list[str] | None = None,
    conflict: list[str] | None = None,
    capture_source: list[str] | None = None,
    tag: list[str] | None = None,
    event_date_from: str | None = None,
    event_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = None,
    media: list[str] | None = None,
    trusted_only: bool = False,
    hide_demo: bool = False,
    bbox: str | None = None,
) -> SAQuery:
    """Apply the standard event filter set to a query.

    Shared by `/events`, `/events/points` and the `/search` event groups so
    the surfaces can't drift. The soft-delete filter lives here so every
    public read excludes `deleted_at IS NOT NULL` rows; the admin path
    bypasses this helper.

    ``view`` scopes to one of the two lifecycle views (see ``VIEWS``);
    ``status`` narrows within the view (any-match within the list, e.g.
    ``?status=closed`` on the requested queue, ``?status=detected`` on the
    located catalog). Status-scoping rather than a bare coordinate predicate:
    a ``requested`` event may carry an approximate guess now, and it must not
    leak into the located catalog because of it. Callers gate values through
    :func:`validate_status_filter`.

    Filter semantics: ``conflict``, ``capture_source`` and ``tag`` each take
    a list of names. Within a list, **any-match (OR)**; across the lists,
    **all-match (AND)**. ``conflict`` matches the ``conflicts`` referential
    (its own join, so a same-named free tag can't poison it);
    ``capture_source`` pins the matched tag's category to its bucket for the
    same reason; ``tag`` matches any tag category so a caller can filter by
    a name without knowing its bucket (back-compat with the pre-multi-select
    API).
    """
    query = query.filter(Event.deleted_at.is_(None), view_predicate(view))

    if status:
        query = query.filter(Event.status.in_(status))

    if conflict:
        # ``.conflicts.any(...)`` lowers to EXISTS so a second relationship
        # filter doesn't row-multiply the way a plain JOIN would.
        query = query.filter(Event.conflicts.any(Conflict.name.in_(conflict)))
    if capture_source:
        query = query.filter(
            Event.tags.any(and_(Tag.name.in_(capture_source), Tag.category == "capture_source"))
        )
    if tag:
        query = query.filter(Event.tags.any(Tag.name.in_(tag)))

    # Parse dates up front so a typo returns a clean 422 instead of
    # cascading into Postgres' ``InvalidDatetimeFormat`` as a 500.
    parsed_event_from = parse_filter_date(event_date_from, "event_date_from")
    parsed_event_to = parse_filter_date(event_date_to, "event_date_to")
    parsed_submitted_from = parse_filter_date(submitted_from, "submitted_from")
    parsed_submitted_to = parse_filter_date(submitted_to, "submitted_to")

    if parsed_event_from:
        query = query.filter(Event.event_date >= parsed_event_from)
    if parsed_event_to:
        query = query.filter(Event.event_date <= parsed_event_to)

    if parsed_submitted_from:
        query = query.filter(Event.created_at >= parsed_submitted_from)
    if parsed_submitted_to:
        # End-of-day inclusive: +1 day with ``<`` (open right interval)
        # is safer than a midnight time string, which would drift around
        # DST boundaries under tz-aware comparison.
        query = query.filter(Event.created_at < parsed_submitted_to + timedelta(days=1))

    if author:
        query = apply_author_filter(query, author)

    if media:
        # ``.media.any(...)`` → EXISTS, so an event with several attachments
        # isn't row-multiplied. Values are ``Media.media_type`` (image / video).
        query = query.filter(Event.media.any(Media.media_type.in_(media)))
    if trusted_only:
        # ``.owner.has(...)`` → EXISTS on the FK, so it can't collide with the
        # ``author`` ilike join above.
        query = query.filter(Event.owner.has(User.is_trusted.is_(True)))
    if hide_demo:
        query = query.filter(Event.is_demo.is_(False))

    if bbox:
        south, west, north, east = parse_bbox(bbox)
        query = query.filter(
            ST_Within(
                Event.event_coords,
                ST_MakeEnvelope(west, south, east, north, 4326),
            )
        )

    return query


@dataclass(frozen=True)
class EventFilters:
    """The filter set as one value, for surfaces that thread it through
    layers (search router → service → the two event groups). ``apply`` is
    :func:`apply_filters` with these fields; ``active`` says whether any
    filter narrows the view (search uses it to flip into browse mode on an
    empty query)."""

    status: list[str] | None = None
    conflict: list[str] | None = None
    capture_source: list[str] | None = None
    tag: list[str] | None = None
    event_date_from: str | None = None
    event_date_to: str | None = None
    submitted_from: str | None = None
    submitted_to: str | None = None
    author: str | None = None
    media: list[str] | None = None
    trusted_only: bool = False
    hide_demo: bool = False

    def apply(self, query: SAQuery, *, view: str) -> SAQuery:
        return apply_filters(
            query,
            view=view,
            **{f.name: getattr(self, f.name) for f in fields(self)},
        )

    @property
    def active(self) -> bool:
        return any(getattr(self, f.name) for f in fields(self))
