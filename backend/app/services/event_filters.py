"""The standard event filter set, shared by every surface that lists events.

`/events`, `/events/points` and `/search` accept the same filter vocabulary, single-sourced here
so the surfaces cannot drift. The bbox, media and status validators raise ``HTTPException(422)``
directly: they are the input boundary for query parameters. Date parsing lives here too
(:func:`parse_optional_iso_date`); ``routers._forms`` re-exports it for the multipart forms.
"""

import math
from dataclasses import dataclass, fields
from datetime import date, timedelta

from fastapi import HTTPException
from geoalchemy2.functions import ST_MakeEnvelope, ST_Within
from sqlalchemy import ColumnElement, and_, func, or_
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


def visible_events() -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    """The public-visibility predicate pair: not soft-deleted, not withheld.

    Every surface that lists, counts or resolves an event for a public reader spreads this
    (``*visible_events()``). Two deliberate non-callers: the event detail read, which hands a
    withheld row to an admin (:func:`routers.events.item.get_event`), and
    :func:`services.reports.set_event_moderation`, which must reach a withheld row to lift the
    takedown.
    """
    return Event.deleted_at.is_(None), Event.hidden_at.is_(None)


def published_events() -> ColumnElement[bool]:
    """The predicate for work an analyst has published: ``geolocated`` alone.

    ``visible_events`` answers "may a reader see this row"; this answers "did this analyst
    stand behind it". The profile feed (:func:`routers.users.get_user_geolocations`), the
    profile's ``geolocations_count`` and the follow feed (:func:`services.social.get_timeline`)
    all filter on it, so counts and rows agree.

    The other states are out:

    * ``detected`` is machine output the analyst has not vouched for.
    * ``closed`` off ``detected`` is a detection the analyst threw out.
    * ``closed`` off ``geolocated`` is published work the analyst retracted. It leaves every
      count and feed at once; the page, its version history, credits and archives stay,
      marked as withdrawn with the reason.
    * ``requested`` is an open call for help with no vouched location, on its own read view
      (see :data:`VIEWS`). ``closed`` off ``requested`` is a withdrawn ask.

    Deliberate non-callers: the ``located`` catalog view, which shows detections beside vouched
    rows (:func:`view_predicate`); the profile coverage map, which plots both and splits the
    count; and :func:`services.user_stats.get_user_stats`, which reports ``geolocated`` and
    ``detected`` as their own tallies and sums them into ``total_events``.
    """
    return Event.status == STATUS_GEOLOCATED


def collectable_events() -> ColumnElement[bool]:
    """The predicate for an event a collection may hold: visible, and worked.

    Every collection read goes through it (item page, count, date range, card mosaic, the add
    verb's eligibility check), so a row that closes, is taken down or is soft-deleted drops out
    of all of them without a write to ``collection_events``.

    It is :func:`visible_events` plus ``geolocated`` and ``detected``. ``requested`` is out
    because a collection curates answers, and ``closed`` is out because a rejected detection
    or a retracted geolocation is a decision the owner took against the row.
    """
    return and_(
        *visible_events(),
        Event.status.in_((STATUS_GEOLOCATED, STATUS_DETECTED)),
    )


def parse_optional_iso_date(raw: str | None, *, field: str) -> date | None:
    """Parse an optional ISO-8601 (YYYY-MM-DD) date. Empty → ``None``; 422 on garbage.

    The one home for date parsing on the request boundary (list-filter params and multipart
    forms). A raw string forwarded into a SQLAlchemy comparison would make Postgres raise
    ``InvalidDatetimeFormat`` as a 500, which an anonymous endpoint turns into scraper-driven
    Sentry noise.

    A full ISO-8601 datetime is truncated to its date (``[:10]``, since ``fromisoformat``
    rejects a time tail), but only after a ``T`` or space separator: ``2026-05-01junk`` and
    ``2026-05-0199`` still 422.
    """
    if not raw:
        return None
    # Anything glued to the date without a separator is garbage: parse it whole and let it fail.
    candidate = raw[:10] if len(raw) > 10 and raw[10] in "T " else raw
    try:
        return date.fromisoformat(candidate)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"{field} must be an ISO-8601 date (YYYY-MM-DD)"
        ) from exc


# Restrict ``?author=`` (and the suggestion query) to real username characters, keeping ``%`` /
# ``\`` LIKE vectors out before any SQL builder. Used as a ``Query(pattern=...)`` guard.
# Hand-kept FE mirror: ``lib/search.ts::AUTHOR_FILTER_RE``.
AUTHOR_FILTER_PATTERN = r"^[A-Za-z0-9_-]{1,50}$"

# Accepted ``media`` filter values (the ``Media.media_type`` domain); a typo returns 422.
MEDIA_TYPES = frozenset({"image", "video"})

# Accepted ``status`` filter values (the ``Event.status`` domain); a typo returns 422. The
# predicate only narrows within the caller's view, so a value the view can't contain returns
# empty. Hand-kept FE mirror: ``STATUS_FILTER_OPTIONS`` in
# ``frontend/src/components/filters/EventFilterSections.tsx`` offers the geolocated / detected
# subset; change the two together (see AGENTS.md).
STATUSES = frozenset({STATUS_REQUESTED, STATUS_DETECTED, STATUS_GEOLOCATED, STATUS_CLOSED})

# The two read views over the one table. ``located`` is the catalog (vouched and machine rows,
# plus a rejected detection). ``requested`` is the open-call queue (plus a withdrawn request).
# Neither serves a retraction, which is reachable by its URL alone: see :func:`view_predicate`.
VIEWS = frozenset({"located", "requested"})


def owner_username_matches(author: str) -> ColumnElement[bool]:
    """The ``?author=`` predicate on a joined :class:`User` row.

    Exact, not substring: ``?author=ana`` must not sweep in every handle containing "ana".
    Callers gate ``author`` through :data:`AUTHOR_FILTER_PATTERN`.

    A predicate rather than a query leg because the event groups reach the owner off
    ``Event.owner`` and the collections group off ``Collection.owner``
    (``services/search.search_collections``); one home keeps them matching alike.
    """
    return func.lower(User.username) == author.lower()


def apply_author_filter(query: SAQuery, author: str) -> SAQuery:
    """Join the event's owner and match the username with the shared predicate."""
    return query.join(Event.owner).filter(owner_username_matches(author))


def view_predicate(view: str):
    """The status predicate for a read view (see ``VIEWS``).

    Each view keeps the closed rows that left its own cohort, so a decision stays legible where
    it was taken. A retraction (``closed`` off ``geolocated``) is in neither: the catalog would
    keep offering a withdrawn claim, while the page stays readable at its URL for anyone who
    cited it.
    """
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


def parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    """Parse ``south,west,north,east`` into validated floats.

    Raises ``HTTPException(422)`` on malformed input instead of falling back to an unfiltered
    query: on a map endpoint a swallowed typo returns every point on Earth.

    Lat in [-90, 90], lng in [-180, 180], south <= north, west <= east. Antimeridian-crossing
    boxes (west > east) are rejected; a client straddling it widens to the full longitude range.
    Hand-kept FE mirror: ``frontend/src/lib/viewport.ts``.
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


# Server-side grid, in degrees, that ``/events/points`` snaps a requested box onto before keying
# its cache. Client viewports arrive at ~11 m precision, so raw boxes are near-unique and would
# miss the cache and let one caller evict every other entry. 0.05 deg is ~5.5 km at the equator.
POINTS_CACHE_GRID = 0.05


def snap_bbox(bounds: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    """Grow a parsed box outward onto :data:`POINTS_CACHE_GRID`.

    Outward only, so the payload always covers the caller's viewport. Callers key the cache and
    build the predicate off the same snapped tuple.
    """
    south, west, north, east = bounds
    return (
        max(-90.0, _snap_down(south)),
        max(-180.0, _snap_down(west)),
        min(90.0, _snap_up(north)),
        min(180.0, _snap_up(east)),
    )


def _snap_down(value: float) -> float:
    """Largest grid line at or below ``value`` (rounded off float dust)."""
    return round(math.floor(value / POINTS_CACHE_GRID) * POINTS_CACHE_GRID, 6)


def _snap_up(value: float) -> float:
    """Smallest grid line at or above ``value``."""
    return round(math.ceil(value / POINTS_CACHE_GRID) * POINTS_CACHE_GRID, 6)


def bbox_predicate(bounds: tuple[float, float, float, float]):
    """PostGIS containment predicate for a bbox already through :func:`parse_bbox`.

    Split from :func:`apply_filters` for callers that parse the bbox themselves (``/events/points``
    parses once, for its cache key).
    """
    south, west, north, east = bounds
    return ST_Within(
        Event.event_coords,
        ST_MakeEnvelope(west, south, east, north, 4326),
    )


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
    bbox: str | None = None,
) -> SAQuery:
    """Apply the standard event filter set to a query.

    The visibility filters live here, so every public read excludes soft-deleted and withheld
    rows; the admin path bypasses this helper.

    ``view`` scopes to one of the two views (see ``VIEWS``); ``status`` narrows within it
    (any-match). Status-scoping rather than a coordinate predicate, since a ``requested`` event
    may carry an approximate guess and must not leak into the located catalog. Callers gate
    values through :func:`validate_status_filter`.

    ``conflict``, ``capture_source`` and ``tag`` take lists of names: any-match (OR) within a
    list, all-match (AND) across lists. ``conflict`` matches the ``conflicts`` referential (its
    own join, so a same-named free tag can't poison it); ``capture_source`` pins the tag's
    category for the same reason; ``tag`` matches any category.
    """
    query = query.filter(*visible_events(), view_predicate(view))

    if status:
        query = query.filter(Event.status.in_(status))

    if conflict:
        # ``.any(...)`` lowers to EXISTS, so it doesn't row-multiply like a JOIN.
        query = query.filter(Event.conflicts.any(Conflict.name.in_(conflict)))
    if capture_source:
        query = query.filter(
            Event.tags.any(and_(Tag.name.in_(capture_source), Tag.category == "capture_source"))
        )
    if tag:
        query = query.filter(Event.tags.any(Tag.name.in_(tag)))

    # Parse dates up front so a typo is a 422, not a Postgres ``InvalidDatetimeFormat`` 500.
    parsed_event_from = parse_optional_iso_date(event_date_from, field="event_date_from")
    parsed_event_to = parse_optional_iso_date(event_date_to, field="event_date_to")
    parsed_submitted_from = parse_optional_iso_date(submitted_from, field="submitted_from")
    parsed_submitted_to = parse_optional_iso_date(submitted_to, field="submitted_to")

    if parsed_event_from:
        query = query.filter(Event.event_date >= parsed_event_from)
    if parsed_event_to:
        query = query.filter(Event.event_date <= parsed_event_to)

    if parsed_submitted_from:
        query = query.filter(Event.created_at >= parsed_submitted_from)
    if parsed_submitted_to:
        # End-of-day inclusive: ``< date + 1 day`` avoids midnight strings drifting around DST.
        query = query.filter(Event.created_at < parsed_submitted_to + timedelta(days=1))

    if author:
        query = apply_author_filter(query, author)

    if media:
        # EXISTS, so an event with several attachments isn't row-multiplied.
        query = query.filter(Event.media.any(Media.media_type.in_(media)))

    if bbox:
        query = query.filter(bbox_predicate(parse_bbox(bbox)))

    return query


@dataclass(frozen=True)
class EventFilters:
    """The filter set as one value, threaded through layers (search router, service, event groups).

    ``active`` says whether any filter narrows the view (search flips into browse mode on an
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

    def apply(self, query: SAQuery, *, view: str) -> SAQuery:
        return apply_filters(
            query,
            view=view,
            **{f.name: getattr(self, f.name) for f in fields(self)},
        )

    @property
    def active(self) -> bool:
        return any(getattr(self, f.name) for f in fields(self))

    @property
    def active_beyond_author(self) -> bool:
        """True when a filter other than ``author`` narrows the view.

        The collections group of search reads this: it can honour "this analyst's collections"
        but empties on any filter it cannot answer (``services/search.search_all``)."""
        return any(getattr(self, f.name) for f in fields(self) if f.name != "author")
