"""Sites: durable places with dated zones, and the events their owners link to them.

Nothing about a site's state is stored. Three rules hold everywhere in this module:

* **The zone valid on a date** is the observation with the greatest
  ``(captured_on, created_at)`` at or before it (:func:`zones_at`). The current
  zone is the latest observation.
* **What a site shows of an event** is one predicate,
  :func:`services.event_filters.site_linkable_events`, so an event that closes,
  is taken down or is soft-deleted leaves every read with no write to
  ``event_site_links``.
* **State comes from observations only.** Link effects are reported beside it
  (``latest_link_effect``), never folded into it.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any

import orjson
from geoalchemy2 import Geography
from geoalchemy2.functions import ST_X, ST_Y
from geoalchemy2.shape import from_shape
from shapely.geometry import Polygon
from shapely.validation import explain_validity
from sqlalchemy import (
    ColumnElement,
    Subquery,
    case,
    cast,
    distinct,
    exists,
    func,
    null,
    or_,
    select,
    true,
)
from sqlalchemy.orm import Session, aliased, joinedload

from app.models.event import Event
from app.models.site import EventSiteLink, LinkEffect, Site, SiteObservation
from app.models.user import User
from app.schemas.event import CoordsRead
from app.schemas.site import (
    EventSiteLinkRead,
    LatestLinkEffect,
    SiteCreate,
    SiteHistoryEntry,
    SiteHistoryEvent,
    SiteLinkedEventRead,
    SiteList,
    SiteNearbyEventRead,
    SiteObservationCreate,
    SiteObservationRead,
    SiteOverlapRead,
    SiteRead,
    SiteRef,
    SiteSuggestionRead,
    ZonePolygon,
)
from app.services.event_filters import lock_event, site_linkable_events, visible_events
from app.services.events import InvalidCoordinatesError, validate_coordinates
from app.services.permissions import ensure_owner

# Sites one map read returns; past it the oldest sites are absent from the response.
MAP_SITES_LIMIT = 1000
OVERLAPS_LIMIT = 20
NEARBY_EVENTS_LIMIT = 50
SUGGESTIONS_LIMIT = 20
MAX_MARGIN_M = 10_000


class SiteError(Exception):
    """A site write or read the rules refuse. Stable ``code`` per subclass."""

    code: str


class SiteNotFoundError(SiteError):
    code = "site_not_found"


class InvalidZoneError(SiteError):
    """A vertex is out of range, or the polygon is not valid (self-crossing, no area)."""

    code = "invalid_zone"


class EventNotLinkableError(SiteError):
    """The event is not one a site shows (:func:`site_linkable_events`)."""

    code = "event_not_linkable"


SITE_ERROR_STATUS: dict[str, int] = {
    "site_not_found": 404,
    "invalid_zone": 400,
    "event_not_linkable": 409,
}


def visible_sites() -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    """Not withheld, and owned by a non-deleted account, like ``collections.visible_collections``."""
    return Site.hidden_at.is_(None), Site.owner.has(User.deleted_at.is_(None))


def live_links() -> ColumnElement[bool]:
    """A link row that is still in force. Every computed read filters on it."""
    return EventSiteLink.unlinked_at.is_(None)


def zone_shape(zone: ZonePolygon) -> Any:
    """The stored geometry for a zone, after the event coordinate bounds on every vertex and a
    validity check."""
    try:
        for ring in zone.coordinates:
            for lng, lat in ring:
                validate_coordinates(lat, lng)
    except InvalidCoordinatesError as exc:
        raise InvalidZoneError(str(exc)) from exc
    polygon = Polygon(zone.coordinates[0], zone.coordinates[1:])
    if not polygon.is_valid:
        raise InvalidZoneError(f"The zone is not a valid polygon: {explain_validity(polygon)}")
    if polygon.area == 0:
        raise InvalidZoneError("The zone has no area")
    return from_shape(polygon, srid=4326)


def _geojson(raw: str) -> ZonePolygon:
    return ZonePolygon.model_validate(orjson.loads(raw))


def zones_at(as_of: date | None) -> Subquery:
    """One row per site: the observation valid on ``as_of``, or the latest when ``None``."""
    query = select(
        SiteObservation.site_id,
        SiteObservation.zone,
        SiteObservation.captured_on,
        SiteObservation.imagery_provider,
        SiteObservation.effect,
    ).distinct(SiteObservation.site_id)
    if as_of is not None:
        query = query.where(SiteObservation.captured_on <= as_of)
    return query.order_by(
        SiteObservation.site_id,
        SiteObservation.captured_on.desc(),
        SiteObservation.created_at.desc(),
    ).subquery("zone_at")


def _latest_link_at(as_of: date | None) -> Any:
    """Per site, the live link to a dated linkable event with the latest ``occurred_date`` on or
    before ``as_of`` (any date when ``None``), the later link winning a tie. Correlates to
    ``Site``."""
    query = (
        select(
            EventSiteLink.effect.label("effect"),
            Event.occurred_date.label("occurred_date"),
            Event.id.label("event_id"),
        )
        .join(Event, Event.id == EventSiteLink.event_id)
        .where(
            EventSiteLink.site_id == Site.id,
            live_links(),
            site_linkable_events(),
            Event.occurred_date.is_not(None),
        )
    )
    if as_of is not None:
        query = query.where(Event.occurred_date <= as_of)
    return (
        query.order_by(Event.occurred_date.desc(), EventSiteLink.linked_at.desc(), Event.id.desc())
        .limit(1)
        .lateral("latest_link")
    )


def _site_states(
    db: Session,
    *,
    as_of: date | None,
    criteria: Sequence[ColumnElement[bool]],
    limit: int,
    bounds: tuple[float, float, float, float] | None = None,
) -> list[tuple[Site, dict[str, Any]]]:
    """Each matching site with the :class:`SiteState` fields, in one statement.

    A site with no observation on or before ``as_of`` is absent, and so is one whose zone
    misses the ``south, west, north, east`` box when one is given.
    """
    zone = zones_at(as_of)
    latest = _latest_link_at(as_of)
    in_box: list[ColumnElement[bool]] = []
    if bounds is not None:
        south, west, north, east = bounds
        envelope = func.ST_MakeEnvelope(west, south, east, north, 4326)
        in_box.append(func.ST_Intersects(zone.c.zone, envelope))
    corroboration_count = (
        select(func.count(distinct(Event.owner_id)))
        .select_from(EventSiteLink)
        .join(Event, Event.id == EventSiteLink.event_id)
        .where(EventSiteLink.site_id == Site.id, live_links(), site_linkable_events())
        .correlate(Site)
        .scalar_subquery()
    )
    corroborated = (
        exists()
        .where(
            EventSiteLink.site_id == Site.id,
            live_links(),
            Event.id == EventSiteLink.event_id,
            site_linkable_events(),
            Event.owner_id != Site.owner_id,
        )
        .correlate(Site)
    )
    centroid = func.ST_Centroid(zone.c.zone)
    rows = (
        db.query(
            Site,
            func.ST_AsGeoJSON(zone.c.zone),
            ST_Y(centroid),
            ST_X(centroid),
            zone.c.captured_on,
            zone.c.imagery_provider,
            zone.c.effect,
            corroboration_count,
            corroborated,
            latest.c.effect,
            latest.c.occurred_date,
            latest.c.event_id,
        )
        .join(zone, zone.c.site_id == Site.id)
        .outerjoin(latest, true())
        .filter(*criteria, *in_box)
        .order_by(Site.created_at.desc(), Site.id.desc())
        .limit(limit)
        .all()
    )
    return [
        (
            site,
            {
                "id": site.id,
                "name": site.name,
                "site_type": site.site_type,
                "zone": _geojson(zone_json),
                "centroid": CoordsRead(lat=lat, lng=lng),
                "observed_on": observed_on,
                "imagery_provider": provider,
                "observation_effect": effect,
                "corroboration_count": count,
                "is_corroborated": is_corroborated,
                "latest_link_effect": None
                if link_event_id is None
                else LatestLinkEffect(
                    effect=link_effect, occurred_date=link_date, event_id=link_event_id
                ),
            },
        )
        for (
            site,
            zone_json,
            lat,
            lng,
            observed_on,
            provider,
            effect,
            count,
            is_corroborated,
            link_effect,
            link_date,
            link_event_id,
        ) in rows
    ]


def list_sites(
    db: Session, *, bounds: tuple[float, float, float, float], as_of: date
) -> list[SiteList]:
    """The visible sites whose zone valid on ``as_of`` meets the ``south, west, north, east`` box."""
    states = _site_states(
        db, as_of=as_of, criteria=visible_sites(), limit=MAP_SITES_LIMIT, bounds=bounds
    )
    return [SiteList(**state, owner_id=site.owner_id) for site, state in states]


def resolve_site(db: Session, *, site_id: uuid.UUID, viewer: User | None) -> Site:
    """A readable site, or :class:`SiteNotFoundError`. An admin also reads a withheld one."""
    query = db.query(Site).options(joinedload(Site.owner)).filter(Site.id == site_id)
    if viewer is None or not viewer.is_admin:
        query = query.filter(*visible_sites())
    site = query.first()
    if site is None:
        raise SiteNotFoundError("Site not found")
    return site


def _observations(db: Session, criterion: ColumnElement[bool]) -> list[SiteObservationRead]:
    rows = (
        db.query(SiteObservation, func.ST_AsGeoJSON(SiteObservation.zone))
        .options(joinedload(SiteObservation.author))
        .filter(criterion)
        .order_by(SiteObservation.captured_on, SiteObservation.created_at)
        .all()
    )
    return [
        SiteObservationRead(
            id=row.id,
            zone=_geojson(zone_json),
            captured_on=row.captured_on,
            imagery_provider=row.imagery_provider,
            imagery_url=row.imagery_url,
            effect=row.effect,
            note=row.note,
            author=row.author,
            created_at=row.created_at,
        )
        for row, zone_json in rows
    ]


def _linked_events(db: Session, site_id: uuid.UUID) -> list[SiteLinkedEventRead]:
    """Visible linked events, each measured against the observation valid on its date.

    The lateral pick orders the observations at or before ``occurred_date`` (all of them for an
    undated event) latest first, then the later ones earliest first, and keeps the first row.
    """
    obs = aliased(SiteObservation)
    valid = or_(Event.occurred_date.is_(None), obs.captured_on <= Event.occurred_date)
    measured = (
        select(obs.id.label("observation_id"), obs.zone.label("zone"))
        .where(obs.site_id == site_id)
        .order_by(
            valid.desc(),
            case((valid, obs.captured_on)).desc().nulls_last(),
            case((valid, obs.created_at)).desc().nulls_last(),
            obs.captured_on.asc(),
            obs.created_at.asc(),
        )
        .limit(1)
        .lateral("measured")
    )
    rows = (
        db.query(
            Event,
            EventSiteLink.effect,
            EventSiteLink.linked_at,
            ST_Y(Event.coords),
            ST_X(Event.coords),
            measured.c.observation_id,
            func.ST_Covers(measured.c.zone, Event.coords),
            func.ST_Distance(cast(Event.coords, Geography), cast(measured.c.zone, Geography)),
        )
        .select_from(EventSiteLink)
        .join(Event, Event.id == EventSiteLink.event_id)
        .join(measured, true())
        .options(joinedload(Event.owner))
        .filter(EventSiteLink.site_id == site_id, live_links(), site_linkable_events())
        .order_by(Event.occurred_date.asc().nulls_last(), Event.created_at.asc())
        .all()
    )
    return [
        SiteLinkedEventRead(
            id=event.id,
            title=event.title,
            occurred_date=event.occurred_date,
            coords=CoordsRead(lat=lat, lng=lng),
            owner=event.owner,
            effect=effect,
            linked_at=linked_at,
            inside_zone=inside,
            distance_m=None if inside else float(distance),
            measured_observation_id=observation_id,
        )
        for event, effect, linked_at, lat, lng, observation_id, inside, distance in rows
    ]


def build_site_read(db: Session, site: Site) -> SiteRead:
    """The full read of one site: current state, observations and linked events."""
    ((_, state),) = _site_states(db, as_of=None, criteria=[Site.id == site.id], limit=1)
    return SiteRead(
        **state,
        owner=site.owner,
        observations=_observations(db, SiteObservation.site_id == site.id),
        linked_events=_linked_events(db, site.id),
        created_at=site.created_at,
        updated_at=site.updated_at,
    )


def find_overlaps(db: Session, zone: ZonePolygon) -> list[SiteOverlapRead]:
    """Visible sites whose current zone shares area with ``zone``, the larger share first.

    Each share is an intersection area over one zone's area, on the spheroid.
    """
    geometry = zone_shape(zone)
    current = zones_at(None)
    intersection = cast(func.ST_Intersection(current.c.zone, geometry), Geography)
    overlap_area = func.ST_Area(intersection)
    new_area = func.ST_Area(cast(geometry, Geography))
    existing_area = func.ST_Area(cast(current.c.zone, Geography))
    rows = (
        db.query(Site, overlap_area / new_area, overlap_area / existing_area)
        .join(current, current.c.site_id == Site.id)
        .filter(*visible_sites(), func.ST_Intersects(current.c.zone, geometry))
        .all()
    )
    overlaps = [
        SiteOverlapRead(
            id=site.id,
            name=site.name,
            site_type=site.site_type,
            share_of_new_zone=min(float(of_new), 1.0),
            share_of_existing_zone=min(float(of_existing), 1.0),
        )
        for site, of_new, of_existing in rows
        if of_new > 0
    ]
    overlaps.sort(key=lambda row: row.share_of_new_zone, reverse=True)
    return overlaps[:OVERLAPS_LIMIT]


def _new_observation(
    site_id: uuid.UUID, author: User, body: SiteObservationCreate
) -> SiteObservation:
    return SiteObservation(
        site_id=site_id,
        author_id=author.id,
        zone=zone_shape(body.zone),
        captured_on=body.captured_on,
        imagery_provider=body.imagery_provider,
        imagery_url=body.imagery_url,
        effect=body.effect,
        note=body.note,
    )


def create_site(
    db: Session, *, owner: User, body: SiteCreate
) -> tuple[Site, list[SiteOverlapRead]]:
    """Write a site and its first observation in one transaction.

    The overlap check runs first and never blocks the create.
    """
    overlaps = find_overlaps(db, body.observation.zone)
    site = Site(owner_id=owner.id, name=body.name, site_type=body.site_type)
    db.add(site)
    try:
        db.flush()
        db.add(_new_observation(site.id, owner, body.observation))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(site)
    return site, overlaps


def add_observation(
    db: Session, *, site: Site, author: User, body: SiteObservationCreate
) -> SiteObservationRead:
    """Append one dated zone to ``site``. Any signed-in analyst may."""
    observation = _new_observation(site.id, author, body)
    db.add(observation)
    db.commit()
    (read,) = _observations(db, SiteObservation.id == observation.id)
    return read


def _current_zone_geography(site_id: uuid.UUID) -> Any:
    current = zones_at(None)
    return (
        select(cast(current.c.zone, Geography))
        .where(current.c.site_id == site_id)
        .scalar_subquery()
    )


def nearby_events(db: Session, *, site: Site, margin_m: float) -> list[SiteNearbyEventRead]:
    """Visible events within ``margin_m`` metres of the current zone and not linked to it,
    nearest first."""
    zone = _current_zone_geography(site.id)
    point = cast(Event.coords, Geography)
    distance = func.ST_Distance(point, zone)
    linked = exists().where(
        EventSiteLink.site_id == site.id, EventSiteLink.event_id == Event.id, live_links()
    )
    rows = (
        db.query(Event, ST_Y(Event.coords), ST_X(Event.coords), distance)
        .options(joinedload(Event.owner))
        .filter(site_linkable_events(), ~linked, func.ST_DWithin(point, zone, margin_m))
        .order_by(distance.asc(), Event.id)
        .limit(NEARBY_EVENTS_LIMIT)
        .all()
    )
    return [
        SiteNearbyEventRead(
            id=event.id,
            title=event.title,
            occurred_date=event.occurred_date,
            coords=CoordsRead(lat=lat, lng=lng),
            owner=event.owner,
            distance_m=float(dist),
        )
        for event, lat, lng, dist in rows
    ]


def suggest_sites(
    db: Session, *, event: Event, margin_m: float, q: str | None
) -> list[SiteSuggestionRead]:
    """Sites an event may link to, nearest first.

    Without ``q``: the visible sites whose current zone lies within ``margin_m`` of the event.
    With ``q``: the visible sites whose name contains it, at any distance. ``distance_m`` is
    null for an event without a point.
    """
    if event.coords is None and not q:
        return []
    current = zones_at(None)
    criteria: list[ColumnElement[bool]] = [*visible_sites()]
    distance: ColumnElement[Any] = null()
    if event.coords is not None:
        point = select(cast(Event.coords, Geography)).where(Event.id == event.id).scalar_subquery()
        zone = cast(current.c.zone, Geography)
        distance = func.ST_Distance(zone, point)
        if not q:
            criteria.append(func.ST_DWithin(zone, point, margin_m))
    if q:
        criteria.append(Site.name.icontains(q, autoescape=True))
    rows = (
        db.query(Site, distance)
        .join(current, current.c.site_id == Site.id)
        .filter(*criteria)
        .order_by(distance.asc().nulls_last(), Site.name, Site.id)
        .limit(SUGGESTIONS_LIMIT)
        .all()
    )
    return [
        SiteSuggestionRead(
            id=site.id,
            name=site.name,
            site_type=site.site_type,
            distance_m=None if dist is None else float(dist),
        )
        for site, dist in rows
    ]


def _link_read(site: Site, link: EventSiteLink) -> EventSiteLinkRead:
    return EventSiteLinkRead(
        site=SiteRef(id=site.id, name=site.name, site_type=site.site_type),
        effect=link.effect,
        linked_at=link.linked_at,
    )


def list_event_links(db: Session, *, event_id: uuid.UUID) -> list[EventSiteLinkRead]:
    """The visible sites an event is linked to now, oldest link first."""
    rows = (
        db.query(Site, EventSiteLink)
        .join(EventSiteLink, EventSiteLink.site_id == Site.id)
        .filter(EventSiteLink.event_id == event_id, live_links(), *visible_sites())
        .order_by(EventSiteLink.linked_at, Site.id)
        .all()
    )
    return [_link_read(site, link) for site, link in rows]


def _live_link(db: Session, *, event_id: uuid.UUID, site_id: uuid.UUID) -> EventSiteLink | None:
    return (
        db.query(EventSiteLink)
        .filter(EventSiteLink.event_id == event_id, EventSiteLink.site_id == site_id, live_links())
        .first()
    )


def link_event(
    db: Session, *, event: Event, user: User, site_id: uuid.UUID, effect: LinkEffect
) -> EventSiteLinkRead:
    """Link the caller's event to a site, or change the effect of its live link.

    Refusals in order: not the event's owner (403), the event is not one a site shows (409),
    no visible site (404). The same effect again writes nothing. A new effect closes the live
    row and opens one whose ``linked_at`` equals the closed row's ``unlinked_at``, which is how
    the history tells an effect change from an unlink. The event row lock serializes link
    writes on one event, so the live-row index never sees two writers.
    """
    ensure_owner(event, user)
    linkable = db.query(site_linkable_events()).filter(Event.id == event.id).scalar()
    if not linkable:
        raise EventNotLinkableError("Only a published, visible event can be linked to a site")
    site = resolve_site(db, site_id=site_id, viewer=None)
    lock_event(db, event.id)
    live = _live_link(db, event_id=event.id, site_id=site.id)
    if live is not None and live.effect == effect:
        db.commit()
        return _link_read(site, live)
    now = datetime.now(UTC)
    if live is not None:
        live.unlinked_at = now
        live.unlinked_by_id = user.id
        db.flush()
    link = EventSiteLink(
        event_id=event.id, site_id=site.id, effect=effect, linked_at=now, linked_by_id=user.id
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _link_read(site, link)


def unlink_event(db: Session, *, event: Event, user: User, site_id: uuid.UUID) -> None:
    """Close the live link between the caller's event and a site. Idempotent; the row stays."""
    ensure_owner(event, user)
    lock_event(db, event.id)
    live = _live_link(db, event_id=event.id, site_id=site_id)
    if live is not None:
        live.unlinked_at = datetime.now(UTC)
        live.unlinked_by_id = user.id
    db.commit()


def _fact_order(entry: SiteHistoryEntry) -> tuple[date, datetime]:
    """A record-only entry happened, on the ground, on the day it was recorded."""
    return (entry.fact_date or entry.recorded_at.date(), entry.recorded_at)


def site_history(db: Session, *, site: Site, order: str) -> list[SiteHistoryEntry]:
    """The site's history, computed from the site, observation and link rows.

    ``order`` is ``fact`` (by ``fact_date``, ``recorded_at`` breaking ties) or ``recorded``.
    Link entries name visible events only, so a withheld or deleted event leaves the history.
    """
    entries = [
        SiteHistoryEntry(
            kind="site_created",
            recorded_at=site.created_at,
            fact_date=None,
            actor=site.owner,
        )
    ]
    for observation in _observations(db, SiteObservation.site_id == site.id):
        entries.append(
            SiteHistoryEntry(
                kind="observation_added",
                recorded_at=observation.created_at,
                fact_date=observation.captured_on,
                actor=observation.author,
                observation_id=observation.id,
                observation_effect=observation.effect,
                imagery_provider=observation.imagery_provider,
            )
        )
    links = (
        db.query(EventSiteLink)
        .join(Event, Event.id == EventSiteLink.event_id)
        .options(
            joinedload(EventSiteLink.event),
            joinedload(EventSiteLink.linked_by),
            joinedload(EventSiteLink.unlinked_by),
        )
        .filter(EventSiteLink.site_id == site.id, *visible_events())
        .all()
    )
    opened = {(link.event_id, link.linked_at): link for link in links}
    closed = {(link.event_id, link.unlinked_at) for link in links if link.unlinked_at}
    for link in links:
        event = SiteHistoryEvent(
            id=link.event.id, title=link.event.title, occurred_date=link.event.occurred_date
        )
        if link.unlinked_at is not None and (link.event_id, link.unlinked_at) in opened:
            successor = opened[(link.event_id, link.unlinked_at)]
            entries.append(
                SiteHistoryEntry(
                    kind="link_effect_changed",
                    recorded_at=successor.linked_at,
                    fact_date=event.occurred_date,
                    actor=successor.linked_by,
                    event=event,
                    link_effect=successor.effect,
                    previous_link_effect=link.effect,
                )
            )
        elif link.unlinked_at is not None:
            entries.append(
                SiteHistoryEntry(
                    kind="event_unlinked",
                    recorded_at=link.unlinked_at,
                    fact_date=event.occurred_date,
                    actor=link.unlinked_by,
                    event=event,
                    link_effect=link.effect,
                )
            )
        if (link.event_id, link.linked_at) not in closed:
            entries.append(
                SiteHistoryEntry(
                    kind="event_linked",
                    recorded_at=link.linked_at,
                    fact_date=event.occurred_date,
                    actor=link.linked_by,
                    event=event,
                    link_effect=link.effect,
                )
            )
    if order == "recorded":
        entries.sort(key=lambda entry: entry.recorded_at)
    else:
        entries.sort(key=_fact_order)
    return entries
