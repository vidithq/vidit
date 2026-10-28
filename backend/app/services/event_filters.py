"""The standard event filter set, shared by every surface that lists events, and
:func:`lock_event`, the row lock every event write takes.

`/events`, `/events/points` and `/search` accept the same filter vocabulary, single-sourced here
so the surfaces cannot drift. The bbox, media and status validators raise ``HTTPException(422)``
directly: they are the input boundary for query parameters. Date parsing lives here too
(:func:`parse_optional_iso_date`); ``routers._forms`` re-exports it for the multipart forms.
"""

import math
import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, fields
from datetime import date, timedelta
from typing import Any, get_args

from fastapi import HTTPException
from geoalchemy2.functions import ST_MakeEnvelope, ST_Within
from sqlalchemy import ColumnElement, CompoundSelect, Select, and_, exists, func, or_, select, union
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session, aliased

from app.models.approval import EventApproval
from app.models.conflict import Conflict
from app.models.event import (
    STATUS_CLOSED,
    STATUS_DETECTED,
    STATUS_GEOLOCATED,
    STATUS_REQUESTED,
    Event,
    EventGeolocator,
)
from app.models.media import Media
from app.models.organization import Organization
from app.models.source import SOURCE_KINDS, Source, SourceLevel
from app.models.tag import Tag
from app.models.user import User


def lock_event(db: Session, event_id: uuid.UUID) -> Event:
    """Re-read the event under ``SELECT ... FOR UPDATE``, so concurrent writes to it serialize.

    ``populate_existing()`` is load-bearing: the caller usually loaded the row already, and
    without it the locked SELECT returns the stale identity-mapped object, so a loser re-checks
    a pre-lock ``status``.
    """
    return db.query(Event).filter(Event.id == event_id).populate_existing().with_for_update().one()


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
    profile's ``geolocations_count`` and the feed (:func:`services.social.get_feed`)
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


def credited_to(user_ids: Iterable[Any] | Select[Any]) -> ColumnElement[bool]:
    """The predicate for an event credited to any of ``user_ids``: owned, or geolocated with them.

    The one home of authorship on the read side. The profile count and feed, the profile stats,
    the follow feed, the ``?author=`` filter and the collection add verb all match through it, so
    an analyst who accepted a credit finds the event wherever their own work is listed. The
    owner leg carries the states without geolocator rows (``detected``, ``requested``); on a
    ``geolocated`` row the owner is a geolocator too.
    """
    return or_(
        Event.owner_id.in_(user_ids),
        Event.geolocators.any(EventGeolocator.user_id.in_(user_ids)),
    )


def ever_credited_ids(event_id: uuid.UUID) -> CompoundSelect:
    """The analysts who hold or held credit on the event: its owner, its co-geolocators and those
    who lost credit (a ``departed`` row, or an ``invited`` one that keeps ``departed_at``). None
    of them approves it or is asked to."""
    return union(
        select(Event.owner_id).where(Event.id == event_id),
        select(EventGeolocator.user_id).where(
            EventGeolocator.event_id == event_id,
            or_(EventGeolocator.state != "invited", EventGeolocator.departed_at.is_not(None)),
        ),
    )


def published_credited_to(user_ids: Iterable[Any] | Select[Any]) -> ColumnElement[bool]:
    """:func:`credited_to` narrowed to published work, as one IN over a UNION.

    :func:`credited_to` ORs the owner leg with a correlated EXISTS, which keeps the planner off
    both indexes. Here each leg is its own indexed lookup (``ix_events_owner_id`` and
    ``ix_event_geolocators_user_id_joined_at``) and the event ids meet in one IN. Reads that count
    only published work use it; :func:`credited_to` stays for the reads that count detected
    and requested rows too.
    """
    owned = aliased(Event)
    credited = union(
        select(owned.id).where(owned.owner_id.in_(user_ids)),
        select(EventGeolocator.event_id).where(
            EventGeolocator.user_id.in_(user_ids), EventGeolocator.state == "active"
        ),
    )
    return and_(published_events(), Event.id.in_(credited))


def open_requests() -> ColumnElement[bool]:
    """The predicate for a request an analyst has open: ``requested``.

    The request twin of :func:`published_events`, read by the feed
    (:func:`services.social.get_feed`). A fulfilled request moves to
    :func:`published_events` and a withdrawn one (``closed`` off ``requested``) drops out.
    """
    return Event.status == STATUS_REQUESTED


def live_detections() -> ColumnElement[bool]:
    """The predicate for a machine detection awaiting its owner: ``detected``.

    The detection twin of :func:`open_requests`, read by the feed
    (:func:`services.social.get_feed`). A submitted detection moves to :func:`published_events`
    and a rejected one (``closed`` off ``detected``) drops out.
    """
    return Event.status == STATUS_DETECTED


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


def site_linkable_events() -> ColumnElement[bool]:
    """The predicate for an event a site may show as linked: visible and published.

    The link verb checks it and every site read filters on it (linked events, the latest link
    effect), so an event that closes, is taken down or is soft-deleted drops out of all of them
    with no write to ``event_site_links``.
    """
    return and_(*visible_events(), published_events())


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

# Accepted ``media`` filter values (the ``Media.kind`` domain); a typo returns 422.
MEDIA_TYPES = frozenset({"image", "video"})

# Accepted ``source_kind`` and ``level`` filter values (the ``Source.kind`` and
# ``Source.level`` domains); a typo returns 422.
SOURCE_KIND_VALUES = frozenset(SOURCE_KINDS)
LEVEL_VALUES = frozenset(get_args(SourceLevel))

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

    A predicate rather than a query leg because the event groups match it on every credited
    analyst (:func:`apply_author_filter`) and the collections group on ``Collection.owner``
    (``services/search.search_collections``); one home keeps them matching alike.
    """
    return func.lower(User.username) == author.lower()


def apply_author_filter(query: SAQuery, author: str) -> SAQuery:
    """Keep the events credited to the analyst the username names (:func:`credited_to`)."""
    return query.filter(credited_to(select(User.id).where(owner_username_matches(author))))


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
    """422 on a ``media`` value outside the ``Media.kind`` domain."""
    if media and not set(media) <= MEDIA_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"media must be one of: {', '.join(sorted(MEDIA_TYPES))}",
        )


def validate_source_filters(source_kind: list[str] | None, level: list[str] | None) -> None:
    """422 on a ``source_kind`` or ``level`` value outside its domain."""
    for field, values, domain in (
        ("source_kind", source_kind, SOURCE_KIND_VALUES),
        ("level", level, LEVEL_VALUES),
    ):
        if values and not set(values) <= domain:
            raise HTTPException(
                status_code=422,
                detail=f"{field} must be one of: {', '.join(sorted(domain))}",
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
        Event.coords,
        ST_MakeEnvelope(west, south, east, north, 4326),
    )


def taxonomy_predicates(
    *,
    conflict: list[str] | None = None,
    source_kind: list[str] | None = None,
    level: list[str] | None = None,
    tag: list[str] | None = None,
) -> list[ColumnElement[bool]]:
    """The ``conflict``, ``source_kind``, ``level`` and ``tag`` predicates, one per non-empty list.

    Any-match (OR) within a list, all-match (AND) across lists. ``conflict`` matches the
    ``conflicts`` referential (its own join, so a same-named free tag can't poison it);
    ``source_kind`` and ``level`` keep an event with a source of that kind or level; ``tag``
    matches a tag on the event or on one of its sources. :func:`apply_filters` and the feed
    (:func:`services.social.get_feed`) both read them. Callers gate ``source_kind`` and
    ``level`` through :func:`validate_source_filters`.
    """
    # ``.any(...)`` lowers to EXISTS, so it doesn't row-multiply like a JOIN.
    predicates: list[ColumnElement[bool]] = []
    if conflict:
        predicates.append(Event.conflicts.any(Conflict.name.in_(conflict)))
    if source_kind:
        predicates.append(Event.sources.any(Source.kind.in_(source_kind)))
    if level:
        predicates.append(Event.sources.any(Source.level.in_(level)))
    if tag:
        predicates.append(
            or_(
                Event.tags.any(Tag.name.in_(tag)),
                Event.sources.any(Source.tags.any(Tag.name.in_(tag))),
            )
        )
    return predicates


def _standing_approval(*criteria: ColumnElement[bool]) -> ColumnElement[bool]:
    """An approval matching ``criteria`` that stands on the live version of a published event:
    the reviews ``services/approvals.build_read`` marks ``current``."""
    return and_(
        Event.status == STATUS_GEOLOCATED,
        exists().where(
            EventApproval.event_id == Event.id,
            EventApproval.version_no == Event.version_no,
            *criteria,
        ),
    )


def approval_predicates(
    *,
    approved: bool = False,
    approved_by: str | None = None,
    approved_by_org: str | None = None,
) -> list[ColumnElement[bool]]:
    """The ``approved``, ``approved_by`` and ``approved_by_org`` predicates, one per set value.

    ``approved`` keeps an event whose live version holds a standing approval, an analyst's or an
    organization's; ``approved_by`` one the analyst the username names approved as themselves;
    ``approved_by_org`` one the organization the slug names approved. Each leg pins
    ``organization_id`` so the lookup stays on the partial unique index of its kind
    (``uq_event_approvals_analyst``, ``uq_event_approvals_organization``). Callers gate the two
    names through :data:`AUTHOR_FILTER_PATTERN`. :func:`apply_filters` and the feed both read them.
    """
    analyst = EventApproval.organization_id.is_(None)
    organization = EventApproval.organization_id.is_not(None)
    predicates: list[ColumnElement[bool]] = []
    if approved:
        predicates.append(or_(_standing_approval(analyst), _standing_approval(organization)))
    if approved_by:
        predicates.append(
            _standing_approval(
                analyst,
                EventApproval.reviewer_id.in_(
                    select(User.id).where(owner_username_matches(approved_by))
                ),
            )
        )
    if approved_by_org:
        predicates.append(
            _standing_approval(
                EventApproval.organization_id.in_(
                    select(Organization.id).where(
                        func.lower(Organization.slug) == approved_by_org.lower()
                    )
                )
            )
        )
    return predicates


def apply_filters(
    query: SAQuery,
    *,
    view: str = "located",
    status: list[str] | None = None,
    conflict: list[str] | None = None,
    source_kind: list[str] | None = None,
    level: list[str] | None = None,
    tag: list[str] | None = None,
    occurred_date_from: str | None = None,
    occurred_date_to: str | None = None,
    submitted_from: str | None = None,
    submitted_to: str | None = None,
    author: str | None = None,
    media: list[str] | None = None,
    approved: bool = False,
    approved_by: str | None = None,
    approved_by_org: str | None = None,
    bbox: str | None = None,
    has_coords: bool | None = None,
) -> SAQuery:
    """Apply the standard event filter set to a query.

    The visibility filters live here, so every public read excludes soft-deleted and withheld
    rows; the admin path bypasses this helper.

    ``view`` scopes to one of the two views (see ``VIEWS``); ``status`` narrows within it
    (any-match). Status-scoping rather than a coordinate predicate, since a ``requested`` event
    may carry an approximate guess and must not leak into the located catalog. Callers gate
    values through :func:`validate_status_filter`.

    ``conflict``, ``source_kind``, ``level`` and ``tag`` take lists of values (see
    :func:`taxonomy_predicates`).

    ``approved``, ``approved_by`` and ``approved_by_org`` keep approved events (see
    :func:`approval_predicates`).

    ``has_coords`` splits on ``coords``: ``True`` keeps rows with a point (a request's
    location guess), ``False`` the blind ones, ``None`` both.
    """
    query = query.filter(*visible_events(), view_predicate(view))

    if status:
        query = query.filter(Event.status.in_(status))

    query = query.filter(
        *taxonomy_predicates(conflict=conflict, source_kind=source_kind, level=level, tag=tag)
    )

    # Parse dates up front so a typo is a 422, not a Postgres ``InvalidDatetimeFormat`` 500.
    parsed_event_from = parse_optional_iso_date(occurred_date_from, field="occurred_date_from")
    parsed_event_to = parse_optional_iso_date(occurred_date_to, field="occurred_date_to")
    parsed_submitted_from = parse_optional_iso_date(submitted_from, field="submitted_from")
    parsed_submitted_to = parse_optional_iso_date(submitted_to, field="submitted_to")

    if parsed_event_from:
        query = query.filter(Event.occurred_date >= parsed_event_from)
    if parsed_event_to:
        query = query.filter(Event.occurred_date <= parsed_event_to)

    if parsed_submitted_from:
        query = query.filter(Event.created_at >= parsed_submitted_from)
    if parsed_submitted_to:
        # End-of-day inclusive: ``< date + 1 day`` avoids midnight strings drifting around DST.
        query = query.filter(Event.created_at < parsed_submitted_to + timedelta(days=1))

    if author:
        query = apply_author_filter(query, author)

    if media:
        # EXISTS, so an event with several files isn't row-multiplied: a source's file or a
        # proof image.
        query = query.filter(
            or_(
                Event.sources.any(Source.media.has(Media.kind.in_(media))),
                Event.media.any(Media.kind.in_(media)),
            )
        )

    query = query.filter(
        *approval_predicates(
            approved=approved, approved_by=approved_by, approved_by_org=approved_by_org
        )
    )

    if bbox:
        query = query.filter(bbox_predicate(parse_bbox(bbox)))

    if has_coords is not None:
        query = query.filter(Event.coords.isnot(None) if has_coords else Event.coords.is_(None))

    return query


@dataclass(frozen=True)
class EventFilters:
    """The filter set as one value, threaded through layers (search router, service, event groups).

    ``active`` says whether any filter narrows the view (search flips into browse mode on an
    empty query)."""

    status: list[str] | None = None
    conflict: list[str] | None = None
    source_kind: list[str] | None = None
    level: list[str] | None = None
    tag: list[str] | None = None
    occurred_date_from: str | None = None
    occurred_date_to: str | None = None
    submitted_from: str | None = None
    submitted_to: str | None = None
    author: str | None = None
    media: list[str] | None = None
    approved: bool = False
    approved_by: str | None = None
    approved_by_org: str | None = None

    def apply(self, query: SAQuery, *, view: str) -> SAQuery:
        return apply_filters(
            query,
            view=view,
            **{f.name: getattr(self, f.name) for f in fields(self)},
        )

    @property
    def active(self) -> bool:
        return any(getattr(self, f.name) for f in fields(self))

    def validate(self) -> None:
        """422 on a value outside its domain, as the query-parameter boundary refuses it.

        For a filter set that arrives as a JSON body (``schemas/collection.SearchMatch``), where no
        ``Query(pattern=...)`` guards the three names. Dates are parsed later, in
        :func:`apply_filters`, which refuses a malformed one the same way.
        """
        validate_media_types(self.media)
        validate_status_filter(self.status)
        validate_source_filters(self.source_kind, self.level)
        for field in ("author", "approved_by", "approved_by_org"):
            value = getattr(self, field)
            if value is not None and not re.fullmatch(AUTHOR_FILTER_PATTERN, value):
                raise HTTPException(
                    status_code=422, detail=f"{field} must match {AUTHOR_FILTER_PATTERN}"
                )

    def active_beyond(self, *kept: str) -> bool:
        """True when a filter other than the ``kept`` field names narrows the view.

        The collections group of search reads this: it honours ``author`` and ``tag`` but
        empties on any filter it cannot answer (``services/search.search_all``)."""
        return any(getattr(self, f.name) for f in fields(self) if f.name not in kept)
