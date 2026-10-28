"""Sites: named areas of interest, their sources, their contours, and the events linked
to them.

Nothing about a site's derived state is stored. Four rules hold everywhere in this module:

* **A site source is a source** whose owner is the site (``sources.site_id``): a dated
  ``satellite`` capture, filed through ``services/events/sources.file_source`` and refused when
  no link lets a reader reopen it (``services/imagery.can_reopen``).
* **The live state** is the site row, its sources with ``removed_at`` NULL and their contours
  with ``superseded_at`` NULL (:func:`live_sources`, :func:`live_contours`). Every write that
  changes it files the state it supersedes first (:func:`_file_version`), whoever makes it.
* **The zone valid on a date** is the live contour whose source has the latest ``captured_at`` on
  or before it (:func:`zones_at`). The current zone is the one valid now.
* **What a site shows of an event** is one predicate,
  :func:`services.event_filters.site_linkable_events`, so an event that closes, is taken down
  or is soft-deleted leaves every read with no write to ``event_site_links``. Links are live
  state with no history and file no version.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
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
    Date,
    Subquery,
    case,
    cast,
    func,
    null,
    or_,
    select,
    true,
)
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from app.models.event import Event
from app.models.media import Media
from app.models.site import EventSiteLink, LinkEffect, Site, SiteContour, SiteVersion
from app.models.source import Source, SourceLink
from app.models.user import User
from app.schemas.event import CoordsRead
from app.schemas.media import MediaRead
from app.schemas.site import (
    MAX_ZONE_AREA_KM2,
    MAX_ZONE_LNG_SPAN_DEG,
    EventSiteLinkRead,
    LatestLinkEffect,
    SiteContourRead,
    SiteCreate,
    SiteEventLinkCreate,
    SiteLastSourceRead,
    SiteLinkedEventRead,
    SiteList,
    SiteOverlapRead,
    SiteRead,
    SiteRef,
    SiteSnapshot,
    SiteSnapshotSource,
    SiteSourceCreate,
    SiteSourceFiledRead,
    SiteSourceRead,
    SiteSuggestionRead,
    SiteVersionCreate,
    SiteVersionRead,
    ZonePolygon,
)
from app.schemas.source import ImageryProviderRead, ImageryProviderRef
from app.schemas.user import AuthorRef
from app.services.event_filters import lock_event, site_linkable_events
from app.services.events import InvalidCoordinatesError, validate_coordinates
from app.services.events.errors import SourceMediaNotFoundError
from app.services.events.sources import build_source_read, file_source
from app.services.evidence_intake import StoredObject, media_objects
from app.services.imagery import LinkCheck, can_reopen, image_provider
from app.services.thumbnails import pick_thumbnail, thumbnail_loads
from app.services.uploads import UPLOAD_ERROR_STATUS
from app.services.versions import MAX_VERSIONS_PER_EVENT, VersionLimitError

# Sites one map read returns; past it the oldest sites are absent from the response.
MAP_SITES_LIMIT = 1000
OVERLAPS_LIMIT = 20
SUGGESTIONS_LIMIT = 20
MAX_MARGIN_M = 10_000


class SiteError(Exception):
    """A site write or read the rules refuse. Stable ``code`` per subclass."""

    code: str


class SiteNotFoundError(SiteError):
    code = "site_not_found"


class NotSiteOwnerError(SiteError):
    """Only the site's owner saves a version of the site."""

    code = "not_site_owner"


class NotSourceAuthorError(SiteError):
    """Only the analyst who filed a source removes it."""

    code = "not_source_author"


class SourceCarriesContourError(SiteError):
    """A source is removed only once it carries no contour."""

    code = "source_carries_contour"


class SiteContourRequiredError(SiteError):
    """A site keeps at least one source with a contour."""

    code = "site_contour_required"


class SiteVersionMismatchError(SiteError):
    """The site moved past the version the write was prepared on."""

    code = "version_mismatch"


class SiteNothingChangedError(SiteError):
    """A version write that changes nothing."""

    code = "nothing_changed"


class SiteVersionNotFoundError(SiteError):
    code = "site_version_not_found"


class NotEventOwnerError(SiteError):
    """Only the event's owner links it to a site or unlinks it."""

    code = "not_event_owner"


class InvalidZoneError(SiteError):
    """A vertex is out of range, or the polygon is not valid (self-crossing, no area)."""

    code = "invalid_zone"


class ZoneTooLargeError(SiteError):
    """The zone covers more than ``MAX_ZONE_AREA_KM2``."""

    code = "zone_too_large"


class ZoneTooWideError(SiteError):
    """The zone spans ``MAX_ZONE_LNG_SPAN_DEG`` degrees of longitude or more."""

    code = "zone_too_wide"


class EventNotLinkableError(SiteError):
    """The event is not one a site shows (:func:`site_linkable_events`)."""

    code = "event_not_linkable"


class SiteSourceNotFoundError(SiteError):
    """The source is not one of the site's live sources."""

    code = "site_source_not_found"


class ImageryNotReopenableError(SiteError):
    """No link of a site source lets a reader reopen it (``services/imagery.can_reopen``)."""

    code = "imagery_not_reopenable"


SITE_ERROR_STATUS: dict[str, int] = {
    **UPLOAD_ERROR_STATUS,
    "site_not_found": 404,
    "site_version_not_found": 404,
    "not_site_owner": 403,
    "not_source_author": 403,
    "not_event_owner": 403,
    "invalid_zone": 400,
    "zone_too_large": 400,
    "zone_too_wide": 400,
    "event_not_linkable": 409,
    "invalid_coordinates": 400,
    "source_carries_contour": 409,
    "site_contour_required": 409,
    "version_mismatch": 409,
    "nothing_changed": 409,
    "site_source_not_found": 404,
    "imagery_not_reopenable": 400,
    "invalid_source_url": 400,
    "source_link_required": 400,
    "too_many_source_links": 400,
    "source_media_not_found": 400,
    "version_limit": 409,
}


def visible_sites() -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    """Not withheld, and owned by a non-deleted account, like ``collections.visible_collections``."""
    return Site.hidden_at.is_(None), Site.owner.has(User.deleted_at.is_(None))


def live_sources() -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    """A site source in the live state: not removed."""
    return Source.site_id.is_not(None), Source.removed_at.is_(None)


def live_contours() -> ColumnElement[bool]:
    """A contour in the live state: not redrawn or dropped."""
    return SiteContour.superseded_at.is_(None)


def _captured_date(column: Any = Source.captured_at) -> ColumnElement[date]:
    """The UTC day of a capture time, whatever the session time zone."""
    return cast(func.timezone("UTC", column), Date)


def _actor(user: User | None) -> AuthorRef | None:
    """The account to credit, or ``None`` once it is soft-deleted or erased."""
    return AuthorRef.model_validate(user) if user is not None and user.deleted_at is None else None


def zone_shape(db: Session, zone: ZonePolygon) -> Any:
    """The stored geometry for a zone, after the event coordinate bounds on every vertex, a
    validity check and the two size caps (longitude span, then geography area)."""
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
    min_lng, _, max_lng, _ = polygon.bounds
    if max_lng - min_lng >= MAX_ZONE_LNG_SPAN_DEG:
        raise ZoneTooWideError(
            f"The zone must span less than {MAX_ZONE_LNG_SPAN_DEG} degrees of longitude"
        )
    geometry = from_shape(polygon, srid=4326)
    area_m2 = db.scalar(select(func.ST_Area(cast(geometry, Geography)))) or 0
    if area_m2 > MAX_ZONE_AREA_KM2 * 1_000_000:
        raise ZoneTooLargeError(f"The zone must cover at most {MAX_ZONE_AREA_KM2:,} km²")
    return geometry


def _geojson(raw: str) -> ZonePolygon:
    return ZonePolygon.model_validate(orjson.loads(raw))


def zones_at(as_of: date | None) -> Subquery:
    """One row per site: the live contour valid on ``as_of``, or the current one when ``None``."""
    query = (
        select(
            SiteContour.id.label("contour_id"),
            SiteContour.site_id.label("site_id"),
            SiteContour.zone.label("zone"),
        )
        .join(Source, Source.id == SiteContour.source_id)
        .where(live_contours())
        .distinct(SiteContour.site_id)
    )
    if as_of is not None:
        query = query.where(_captured_date() <= as_of)
    return query.order_by(
        SiteContour.site_id, Source.captured_at.desc(), SiteContour.created_at.desc()
    ).subquery("zone_at")


def _latest_link_at(as_of: date | None) -> Any:
    """Per site, the link to a dated linkable event with the latest ``occurred_date`` on or
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


def _link_urls(db: Session, source_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    """Each source's link URLs, in the source's link order."""
    urls: dict[uuid.UUID, list[str]] = defaultdict(list)
    if not source_ids:
        return urls
    for source_id, url in (
        db.query(SourceLink.source_id, SourceLink.url)
        .filter(SourceLink.source_id.in_(source_ids))
        .order_by(
            SourceLink.source_id,
            SourceLink.posted_at.asc().nulls_last(),
            SourceLink.created_at,
            SourceLink.id,
        )
    ):
        urls[source_id].append(url)
    return urls


def _last_sources(
    db: Session, site_ids: Sequence[uuid.UUID], as_of: date | None
) -> dict[uuid.UUID, SiteLastSourceRead]:
    """Per site, the live source with the latest capture on or before ``as_of``, with its
    provider."""
    if not site_ids:
        return {}
    query = (
        db.query(Source.id, Source.site_id, Source.captured_at)
        .filter(Source.site_id.in_(site_ids), *live_sources())
        .distinct(Source.site_id)
    )
    if as_of is not None:
        query = query.filter(_captured_date() <= as_of)
    rows = query.order_by(Source.site_id, Source.captured_at.desc(), Source.created_at.desc()).all()
    urls = _link_urls(db, [row.id for row in rows])
    last: dict[uuid.UUID, SiteLastSourceRead] = {}
    for row in rows:
        provider = image_provider(urls[row.id])
        last[row.site_id] = SiteLastSourceRead(
            id=row.id,
            captured_at=row.captured_at,
            provider=ImageryProviderRef.model_validate(provider) if provider else None,
        )
    return last


def _site_states(
    db: Session,
    *,
    as_of: date | None,
    criteria: Sequence[ColumnElement[bool]],
    limit: int,
    bounds: tuple[float, float, float, float] | None = None,
) -> list[tuple[Site, dict[str, Any]]]:
    """Each matching site with the :class:`SiteState` fields, read at ``as_of``.

    A site with no contour on or before ``as_of`` is absent, and so is one whose zone misses
    the ``south, west, north, east`` box when one is given.
    """
    zone = zones_at(as_of)
    latest = _latest_link_at(as_of)
    in_box: list[ColumnElement[bool]] = []
    if bounds is not None:
        south, west, north, east = bounds
        envelope = func.ST_MakeEnvelope(west, south, east, north, 4326)
        in_box.append(func.ST_Intersects(zone.c.zone, envelope))
    centroid = func.ST_Centroid(zone.c.zone)
    rows = (
        db.query(
            Site,
            func.ST_AsGeoJSON(zone.c.zone),
            ST_Y(centroid),
            ST_X(centroid),
            zone.c.contour_id,
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
    site_ids = [row[0].id for row in rows]
    last_sources = _last_sources(db, site_ids, as_of)
    states: list[tuple[Site, dict[str, Any]]] = []
    for site, zone_json, lat, lng, contour_id, link_effect, link_date, link_event_id in rows:
        states.append(
            (
                site,
                {
                    "id": site.id,
                    "name": site.name,
                    "kind": site.kind,
                    "zone": _geojson(zone_json),
                    "centroid": CoordsRead(lat=lat, lng=lng),
                    "contour_id": contour_id,
                    "last_source": last_sources.get(site.id),
                    "latest_link_effect": None
                    if link_event_id is None
                    else LatestLinkEffect(
                        effect=link_effect, occurred_date=link_date, event_id=link_event_id
                    ),
                },
            )
        )
    return states


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


def _source_read(source: Source) -> SiteSourceRead:
    provider = image_provider([link.url for link in source.links])
    return SiteSourceRead(
        **build_source_read(source).model_dump(),
        provider=ImageryProviderRead.model_validate(provider) if provider else None,
        author=_actor(source.author),
        note=source.note,
        created_at=source.created_at,
    )


def _sources(db: Session, *criteria: ColumnElement[bool]) -> list[SiteSourceRead]:
    rows = (
        db.query(Source)
        .options(
            selectinload(Source.links),
            selectinload(Source.tags),
            selectinload(Source.media),
            joinedload(Source.author),
        )
        .filter(Source.site_id.is_not(None), *criteria)
        .order_by(Source.captured_at, Source.created_at, Source.id)
        .all()
    )
    return [_source_read(row) for row in rows]


def _contours(db: Session, *criteria: ColumnElement[bool]) -> list[SiteContourRead]:
    rows = (
        db.query(SiteContour, func.ST_AsGeoJSON(SiteContour.zone), Source.captured_at)
        .join(Source, Source.id == SiteContour.source_id)
        .options(joinedload(SiteContour.author))
        .filter(*criteria)
        .order_by(Source.captured_at, SiteContour.created_at, SiteContour.id)
        .all()
    )
    return [
        SiteContourRead(
            id=contour.id,
            zone=_geojson(zone_json),
            source_id=contour.source_id,
            captured_at=captured_at,
            author=_actor(contour.author),
            created_at=contour.created_at,
        )
        for contour, zone_json, captured_at in rows
    ]


def _thumbnail(event: Event) -> MediaRead | None:
    row = pick_thumbnail(event)
    return MediaRead.model_validate(row) if row is not None else None


def _linked_events(db: Session, site_id: uuid.UUID) -> list[SiteLinkedEventRead]:
    """Visible linked events, each measured against the live contour valid on its date.

    The lateral pick orders the contours whose source is captured on or before ``occurred_date``
    (all of them for an undated event) latest first, then the later ones earliest first, and
    keeps the first row.
    """
    contour = aliased(SiteContour)
    source = aliased(Source)
    valid = or_(
        Event.occurred_date.is_(None), _captured_date(source.captured_at) <= Event.occurred_date
    )
    measured = (
        select(contour.id.label("contour_id"), contour.zone.label("zone"))
        .join(source, source.id == contour.source_id)
        .where(contour.site_id == site_id, contour.superseded_at.is_(None))
        .order_by(
            valid.desc(),
            case((valid, source.captured_at)).desc().nulls_last(),
            case((valid, contour.created_at)).desc().nulls_last(),
            source.captured_at.asc(),
            contour.created_at.asc(),
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
            measured.c.contour_id,
            func.ST_Covers(measured.c.zone, Event.coords),
            func.ST_Distance(cast(Event.coords, Geography), cast(measured.c.zone, Geography)),
        )
        .select_from(EventSiteLink)
        .join(Event, Event.id == EventSiteLink.event_id)
        .join(measured, true())
        .options(joinedload(Event.owner), *thumbnail_loads())
        .filter(EventSiteLink.site_id == site_id, site_linkable_events())
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
            is_graphic=event.is_graphic,
            media=_thumbnail(event),
            effect=effect,
            linked_at=linked_at,
            inside_zone=inside,
            distance_m=None if inside else float(distance),
            measured_contour_id=contour_id,
        )
        for event, effect, linked_at, lat, lng, contour_id, inside, distance in rows
    ]


def build_site_read(db: Session, site: Site) -> SiteRead:
    """The full read of one site: current state, live sources and contours, linked events."""
    ((_, state),) = _site_states(db, as_of=None, criteria=[Site.id == site.id], limit=1)
    return SiteRead(
        **state,
        owner=site.owner,
        version_no=site.version_no,
        hidden_at=site.hidden_at,
        sources=_sources(db, Source.site_id == site.id, *live_sources()),
        contours=_contours(db, SiteContour.site_id == site.id, live_contours()),
        linked_events=_linked_events(db, site.id),
        created_at=site.created_at,
        updated_at=site.updated_at,
    )


def find_overlaps(db: Session, zone: ZonePolygon) -> list[SiteOverlapRead]:
    """Visible sites whose current zone shares area with ``zone``, the larger share first.

    Each share is an intersection area over one zone's area, on the spheroid.
    """
    geometry = zone_shape(db, zone)
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
            kind=site.kind,
            share_of_new_zone=min(float(of_new), 1.0),
            share_of_existing_zone=min(float(of_existing), 1.0),
        )
        for site, of_new, of_existing in rows
        if of_new > 0
    ]
    overlaps.sort(key=lambda row: row.share_of_new_zone, reverse=True)
    return overlaps[:OVERLAPS_LIMIT]


def _require_site_owner(site: Site, user: User) -> None:
    if site.owner_id != user.id:
        raise NotSiteOwnerError("Only the site's owner can make this change")


def _lock_site(db: Session, site: Site) -> Site:
    """The site row under its lock, which serializes the writes that take a version number."""
    return db.query(Site).filter(Site.id == site.id).populate_existing().with_for_update().one()


def _snapshot(db: Session, site: Site) -> SiteSnapshot:
    """The live state of ``site``: its record and its live sources, each with its live contour."""
    rows = (
        db.query(Source.id, SiteContour.id)
        .outerjoin(SiteContour, (SiteContour.source_id == Source.id) & live_contours())
        .filter(Source.site_id == site.id, *live_sources())
        .order_by(Source.captured_at, Source.created_at, Source.id)
        .all()
    )
    return SiteSnapshot(
        name=site.name,
        kind=site.kind,
        sources=[
            SiteSnapshotSource(id=source_id, contour_id=contour_id)
            for source_id, contour_id in rows
        ],
    )


def _file_version(db: Session, *, site: Site, editor: User, note: str | None = None) -> None:
    """File the live state of the locked ``site``, with the editor's ``note``, and move it to
    the next version.

    Call it before any write to the state. Raises ``VersionLimitError`` past the event ceiling of
    versions. Staged, not committed.
    """
    if site.version_no >= MAX_VERSIONS_PER_EVENT:
        raise VersionLimitError(
            f"This site has reached {MAX_VERSIONS_PER_EVENT} versions and can no longer be edited."
        )
    db.add(
        SiteVersion(
            site_id=site.id,
            version_no=site.version_no,
            edited_by_id=editor.id,
            note=note,
            snapshot=_snapshot(db, site).model_dump(mode="json"),
        )
    )
    site.version_no += 1


def _event_file(db: Session, media_id: uuid.UUID) -> Media:
    """The file of a satellite source of a published, visible event, to copy onto a site source.
    A graphic source's file is refused: a site source carries no graphic cover."""
    media = (
        db.query(Media)
        .join(Source, Source.id == Media.source_id)
        .join(Event, Event.id == Source.event_id)
        .filter(
            Media.id == media_id,
            Source.kind == "satellite",
            Source.is_graphic.is_(False),
            site_linkable_events(),
        )
        .first()
    )
    if media is None:
        raise SourceMediaNotFoundError(f"A source names a file that does not exist: {media_id}")
    return media


def _stage_site_source(
    db: Session, *, site_id: uuid.UUID, author: User, body: SiteSourceCreate
) -> Source:
    """Stage one site source, refused when no link reopens it. Flushed, not committed."""
    source = file_source(
        db,
        source=Source(
            site_id=site_id,
            author_id=author.id,
            title=body.title,
            level="context",
            kind="satellite",
            captured_at=body.captured_at,
            note=body.note,
        ),
        links=body.links,
        uploader=author,
        upload_id=body.upload_id,
        copy_of=_event_file(db, body.media_id) if body.media_id else None,
    )
    checks = [LinkCheck(link.url, archived=link.snapshot_url is not None) for link in source.links]
    if not can_reopen(checks):
        raise ImageryNotReopenableError(
            "No link lets a reader reopen this source. Link a permalink from an accepted imagery "
            "provider, or archive the publication that shows the source."
        )
    db.flush()
    return source


def _duplicates(db: Session, source: Source) -> list[uuid.UUID]:
    """The other live sources of the site with the same provider and the same capture day."""
    provider = image_provider([link.url for link in source.links])
    if provider is None or source.captured_at is None:
        return []
    candidates = (
        db.query(Source.id)
        .filter(
            Source.site_id == source.site_id,
            Source.removed_at.is_(None),
            Source.id != source.id,
            _captured_date() == source.captured_at.astimezone(UTC).date(),
        )
        .all()
    )
    urls = _link_urls(db, [row.id for row in candidates])
    return [
        row.id
        for row in candidates
        if (other := image_provider(urls[row.id])) is not None and other.id == provider.id
    ]


def _require_event_owner(event: Event, user: User) -> None:
    if event.owner_id != user.id:
        raise NotEventOwnerError("Only the event's owner links it to a site")


def _require_linkable(db: Session, event_ids: Sequence[uuid.UUID]) -> None:
    linkable = set(
        db.scalars(select(Event.id).where(Event.id.in_(event_ids), site_linkable_events()))
    )
    if any(event_id not in linkable for event_id in event_ids):
        raise EventNotLinkableError("Only a published, visible event can be linked to a site")


def _lock_own_events(db: Session, *, user: User, links: Sequence[SiteEventLinkCreate]) -> None:
    """Check that the caller owns every event of ``links`` and that a site shows each, then lock
    them in id order. Refusals in order: not the event's owner (403), not linkable (409)."""
    event_ids = sorted(link.event_id for link in links)
    if not event_ids:
        return
    owners: dict[uuid.UUID, uuid.UUID] = {
        row.id: row.owner_id
        for row in db.query(Event.id, Event.owner_id).filter(Event.id.in_(event_ids)).all()
    }
    for event_id in event_ids:
        if event_id in owners and owners[event_id] != user.id:
            raise NotEventOwnerError("Only the event's owner links it to a site")
    _require_linkable(db, event_ids)
    for event_id in event_ids:
        lock_event(db, event_id)


def _own_links(db: Session, *, site_id: uuid.UUID, user: User) -> dict[uuid.UUID, EventSiteLink]:
    """The links of ``site_id`` to the caller's events that the site shows, by event."""
    rows = (
        db.query(EventSiteLink)
        .join(Event, Event.id == EventSiteLink.event_id)
        .filter(EventSiteLink.site_id == site_id, Event.owner_id == user.id, site_linkable_events())
        .all()
    )
    return {row.event_id: row for row in rows}


def _set_links(
    db: Session,
    *,
    site_id: uuid.UUID,
    current: dict[uuid.UUID, EventSiteLink],
    links: Sequence[SiteEventLinkCreate],
) -> None:
    """Make ``links`` the caller's links to the site: a new event links, a new effect rewrites
    the link, and a link of ``current`` the list leaves out is deleted. Staged."""
    wanted = {link.event_id: link.effect for link in links}
    for event_id, row in current.items():
        if event_id not in wanted:
            db.delete(row)
        elif row.effect != wanted[event_id]:
            row.effect = wanted[event_id]
    for event_id, effect in wanted.items():
        if event_id not in current:
            db.add(EventSiteLink(event_id=event_id, site_id=site_id, effect=effect))


def _links_change(
    current: dict[uuid.UUID, EventSiteLink], links: Sequence[SiteEventLinkCreate]
) -> bool:
    return {event_id: row.effect for event_id, row in current.items()} != {
        link.event_id: link.effect for link in links
    }


def create_site(
    db: Session, *, owner: User, body: SiteCreate
) -> tuple[Site, list[SiteOverlapRead]]:
    """Write a site at version 1, its first source, the contour that source shows and the owner's
    linked events, in one transaction.

    The overlap check runs first and never blocks the create.
    """
    overlaps = find_overlaps(db, body.contour)
    try:
        _lock_own_events(db, user=owner, links=body.event_links)
        site = Site(owner_id=owner.id, name=body.name, kind=body.kind)
        db.add(site)
        db.flush()
        source = _stage_site_source(db, site_id=site.id, author=owner, body=body.source)
        db.add(
            SiteContour(
                site_id=site.id,
                source_id=source.id,
                author_id=owner.id,
                zone=zone_shape(db, body.contour),
            )
        )
        _set_links(db, site_id=site.id, current={}, links=body.event_links)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(site)
    return site, overlaps


def file_site_source(
    db: Session, *, site: Site, author: User, body: SiteSourceCreate
) -> SiteSourceFiledRead:
    """File one source on ``site``, filing a version. Any signed-in analyst may.

    A source already filed with the same provider and capture day is flagged in
    ``duplicate_source_ids``, never refused.
    """
    try:
        locked = _lock_site(db, site)
        _file_version(db, site=locked, editor=author)
        source = _stage_site_source(db, site_id=site.id, author=author, body=body)
        duplicates = _duplicates(db, source)
        db.commit()
    except Exception:
        db.rollback()
        raise
    (read,) = _sources(db, Source.id == source.id)
    return SiteSourceFiledRead(**read.model_dump(), duplicate_source_ids=duplicates)


def _live_source(sources: dict[uuid.UUID, Source], source_id: uuid.UUID) -> Source:
    source = sources.get(source_id)
    if source is None:
        raise SiteSourceNotFoundError(f"The source {source_id} is not one of this site's sources")
    return source


def _require_source_author(source: Source, user: User) -> None:
    if source.author_id != user.id:
        raise NotSourceAuthorError("Only the analyst who filed a source removes it")


def remove_site_source(db: Session, *, site: Site, user: User, source_id: uuid.UUID) -> None:
    """Remove the caller's source from ``site``'s live state, filing a version. The source's row
    stays for the versions that name it.

    Refusals in order: not a live source of the site (404), not the caller's (403), it carries a
    contour (409), the version ceiling (409).
    """
    try:
        locked = _lock_site(db, site)
        sources = {
            row.id: row
            for row in db.query(Source).filter(Source.site_id == site.id, *live_sources())
        }
        source = _live_source(sources, source_id)
        _require_source_author(source, user)
        carries = db.query(SiteContour.id).filter(
            SiteContour.source_id == source.id, live_contours()
        )
        if carries.first() is not None:
            raise SourceCarriesContourError(
                "This source carries a contour: the site's owner redraws it on another source first"
            )
        _file_version(db, site=locked, editor=user)
        source.removed_at = datetime.now(UTC)
        db.commit()
    except Exception:
        db.rollback()
        raise


def save_version(db: Session, *, site: Site, user: User, body: SiteVersionCreate) -> Site:
    """Apply the owner's edit in one transaction: the record, the added and removed sources, the
    contour changes and the owner's linked events. A change to the record, the sources or a
    contour files one version first; a change to the links alone files none.

    Refusals in order: not the owner (403), the site moved past ``version_no`` (409), a source
    that is not a live source of the site (404), a source the caller did not file (403), a source
    removed while it keeps a contour (409), no contour left (409), an invalid zone (400), the
    links' refusals, nothing changed (409), the version ceiling (409), then the source intake's.
    """
    _require_site_owner(site, user)
    try:
        locked = _lock_site(db, site)
        if body.version_no != locked.version_no:
            raise SiteVersionMismatchError(
                f"This site is at version {locked.version_no}; reload it before saving"
            )
        sources = {
            row.id: row
            for row in db.query(Source).filter(Source.site_id == site.id, *live_sources())
        }
        contours = {
            row.source_id: row
            for row in db.query(SiteContour).filter(SiteContour.site_id == site.id, live_contours())
        }
        removed = [_live_source(sources, source_id) for source_id in body.removed_source_ids]
        for source in removed:
            _require_source_author(source, user)
        changes = {change.target: change for change in body.contours}
        for change in body.contours:
            if change.source_id is not None:
                _live_source(sources, change.source_id)
        for source in removed:
            pending = changes.get(source.id)
            if (source.id in contours and pending is None) or (
                pending is not None and pending.zone is not None
            ):
                raise SourceCarriesContourError(
                    "A source is removed once it carries no contour: redraw it on another one first"
                )
        kept = {source_id for source_id in contours if source_id not in changes}
        drawn = [key for key, change in changes.items() if change.zone is not None]
        if not kept and not drawn:
            raise SiteContourRequiredError("A site keeps at least one source with a contour")
        shapes = {
            key: zone_shape(db, change.zone)
            for key, change in changes.items()
            if change.zone is not None
        }
        effective = [
            key for key, change in changes.items() if change.zone is not None or key in contours
        ]

        current_links: dict[uuid.UUID, EventSiteLink] = {}
        if body.event_links is not None:
            _lock_own_events(db, user=user, links=body.event_links)
            current_links = _own_links(db, site_id=site.id, user=user)
        links_move = body.event_links is not None and _links_change(current_links, body.event_links)
        record_moves = (body.name, body.kind) != (locked.name, locked.kind)
        state_moves = record_moves or bool(removed or effective or body.added_sources)
        if not state_moves and not links_move:
            raise SiteNothingChangedError(f"Nothing changed since version {locked.version_no}.")

        if state_moves:
            _file_version(db, site=locked, editor=user, note=body.note)
        locked.name, locked.kind = body.name, body.kind
        added = [
            _stage_site_source(db, site_id=site.id, author=user, body=source)
            for source in body.added_sources
        ]
        now = datetime.now(UTC)
        for source in removed:
            source.removed_at = now
        for key in effective:
            source_id = key if isinstance(key, uuid.UUID) else added[key].id
            if source_id in contours:
                contours[source_id].superseded_at = now
        db.flush()
        for key, geometry in shapes.items():
            source_id = key if isinstance(key, uuid.UUID) else added[key].id
            db.add(
                SiteContour(site_id=site.id, source_id=source_id, author_id=user.id, zone=geometry)
            )
        if body.event_links is not None:
            _set_links(db, site_id=site.id, current=current_links, links=body.event_links)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(locked)
    return locked


def suggest_sites(
    db: Session, *, event: Event, margin_m: float, q: str | None
) -> list[SiteSuggestionRead]:
    """Sites an event may link to, measured from the event's point (:func:`_suggest`)."""
    point = (
        None
        if event.coords is None
        else select(cast(Event.coords, Geography)).where(Event.id == event.id).scalar_subquery()
    )
    return _suggest(db, point=point, margin_m=margin_m, q=q)


def suggest_sites_near(
    db: Session, *, lat: float | None, lng: float | None, margin_m: float, q: str | None
) -> list[SiteSuggestionRead]:
    """Sites a point may link to, for an event form whose event is not written yet.

    ``lat`` and ``lng`` come both or neither: :class:`InvalidCoordinatesError` otherwise, or
    when they fall out of range.
    """
    if (lat is None) != (lng is None):
        raise InvalidCoordinatesError("Send both lat and lng, or neither")
    point: ColumnElement[Any] | None = None
    if lat is not None and lng is not None:
        validate_coordinates(lat, lng)
        point = cast(func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326), Geography)
    return _suggest(db, point=point, margin_m=margin_m, q=q)


def _suggest(
    db: Session, *, point: Any, margin_m: float, q: str | None
) -> list[SiteSuggestionRead]:
    """Sites a point may link to, nearest first.

    Without ``q``: the visible sites whose current zone lies within ``margin_m`` of ``point``.
    With ``q``: the visible sites whose name contains it, at any distance. ``distance_m`` is
    null without a point.
    """
    if point is None and not q:
        return []
    current = zones_at(None)
    criteria: list[ColumnElement[bool]] = [*visible_sites()]
    distance: ColumnElement[Any] = null()
    order: list[Any] = [Site.name, Site.id]
    if point is not None:
        zone = cast(current.c.zone, Geography)
        distance = func.ST_Distance(zone, point)
        order.insert(0, distance.asc())
        if not q:
            criteria.append(func.ST_DWithin(zone, point, margin_m))
    if q:
        criteria.append(Site.name.icontains(q, autoescape=True))
    rows = (
        db.query(Site, distance)
        .join(current, current.c.site_id == Site.id)
        .filter(*criteria)
        .order_by(*order)
        .limit(SUGGESTIONS_LIMIT)
        .all()
    )
    return [
        SiteSuggestionRead(
            id=site.id,
            name=site.name,
            kind=site.kind,
            distance_m=None if dist is None else float(dist),
        )
        for site, dist in rows
    ]


def _link_read(site: Site, link: EventSiteLink) -> EventSiteLinkRead:
    return EventSiteLinkRead(
        site=SiteRef(id=site.id, name=site.name, kind=site.kind),
        effect=link.effect,
        linked_at=link.linked_at,
    )


def list_event_links(db: Session, *, event_id: uuid.UUID) -> list[EventSiteLinkRead]:
    """The visible sites an event is linked to now, oldest link first."""
    rows = (
        db.query(Site, EventSiteLink)
        .join(EventSiteLink, EventSiteLink.site_id == Site.id)
        .filter(EventSiteLink.event_id == event_id, *visible_sites())
        .order_by(EventSiteLink.linked_at, Site.id)
        .all()
    )
    return [_link_read(site, link) for site, link in rows]


def _link(db: Session, *, event_id: uuid.UUID, site_id: uuid.UUID) -> EventSiteLink | None:
    return (
        db.query(EventSiteLink)
        .filter(EventSiteLink.event_id == event_id, EventSiteLink.site_id == site_id)
        .first()
    )


def link_event(
    db: Session, *, event: Event, user: User, site_id: uuid.UUID, effect: LinkEffect
) -> EventSiteLinkRead:
    """Link the caller's event to a site, or change the effect of its link. Files no version.

    Refusals in order: not the event's owner (403), the event is not one a site shows (409), no
    visible site (404). The event row lock serializes link writes on one event.
    """
    _require_event_owner(event, user)
    _require_linkable(db, [event.id])
    site = resolve_site(db, site_id=site_id, viewer=None)
    lock_event(db, event.id)
    link = _link(db, event_id=event.id, site_id=site.id)
    if link is None:
        link = EventSiteLink(event_id=event.id, site_id=site.id, effect=effect)
        db.add(link)
    else:
        link.effect = effect
    db.commit()
    db.refresh(link)
    return _link_read(site, link)


def unlink_event(db: Session, *, event: Event, user: User, site_id: uuid.UUID) -> None:
    """Delete the link between the caller's event and a site. Idempotent; files no version."""
    _require_event_owner(event, user)
    lock_event(db, event.id)
    db.query(EventSiteLink).filter(
        EventSiteLink.event_id == event.id, EventSiteLink.site_id == site_id
    ).delete(synchronize_session=False)
    db.commit()


def count_versions(db: Session, site_id: uuid.UUID) -> int:
    return db.query(SiteVersion).filter(SiteVersion.site_id == site_id).count()


def list_versions(
    db: Session, site_id: uuid.UUID, *, limit: int, cursor: int | None = None
) -> list[SiteVersion]:
    """One page of the site's superseded versions, newest first, over-fetched by one row
    (``services/pagination.paged``), on the ``version_no`` cursor of
    ``services/versions.list_versions``."""
    query = (
        db.query(SiteVersion)
        .options(joinedload(SiteVersion.edited_by))
        .filter(SiteVersion.site_id == site_id)
    )
    if cursor is not None:
        query = query.filter(SiteVersion.version_no < cursor)
    return query.order_by(SiteVersion.version_no.desc()).limit(limit + 1).all()


def get_version(db: Session, *, site_id: uuid.UUID, version_no: int) -> SiteVersion:
    """One superseded version by its number (the ``/vN`` address), or
    :class:`SiteVersionNotFoundError`; the live number is not one."""
    row = (
        db.query(SiteVersion)
        .options(joinedload(SiteVersion.edited_by))
        .filter(SiteVersion.site_id == site_id, SiteVersion.version_no == version_no)
        .first()
    )
    if row is None:
        raise SiteVersionNotFoundError("Version not found")
    return row


def _contour_order(contour: SiteContourRead) -> tuple[datetime, datetime, uuid.UUID]:
    return contour.captured_at, contour.created_at, contour.id


def build_version_reads(db: Session, rows: Sequence[SiteVersion]) -> list[SiteVersionRead]:
    """Each version with the sources and contours its snapshot names, read in two queries, and
    the state they give: the current zone is the contour of the latest captured source, as
    :func:`zones_at` picks it, and the centroid is the planar one PostGIS computes."""
    snapshots = [SiteSnapshot.model_validate(row.snapshot) for row in rows]
    source_ids = {source.id for snapshot in snapshots for source in snapshot.sources}
    contour_ids = {
        source.contour_id
        for snapshot in snapshots
        for source in snapshot.sources
        if source.contour_id
    }
    sources = (
        {read.id: read for read in _sources(db, Source.id.in_(source_ids))} if source_ids else {}
    )
    contours = (
        {read.id: read for read in _contours(db, SiteContour.id.in_(contour_ids))}
        if contour_ids
        else {}
    )
    reads: list[SiteVersionRead] = []
    for row, snapshot in zip(rows, snapshots, strict=True):
        version_sources = [sources[source.id] for source in snapshot.sources]
        version_contours = sorted(
            (contours[source.contour_id] for source in snapshot.sources if source.contour_id),
            key=_contour_order,
        )
        current = version_contours[-1]
        centroid = Polygon(current.zone.coordinates[0], current.zone.coordinates[1:]).centroid
        last = max(version_sources, key=lambda source: (source.captured_at, source.created_at))
        assert last.captured_at is not None  # ck_sources_site_capture
        reads.append(
            SiteVersionRead(
                id=row.id,
                version_no=row.version_no,
                edited_by=_actor(row.edited_by),
                created_at=row.created_at,
                note=row.note,
                name=snapshot.name,
                kind=snapshot.kind,
                zone=current.zone,
                centroid=CoordsRead(lat=centroid.y, lng=centroid.x),
                contour_id=current.id,
                last_source=SiteLastSourceRead(
                    id=last.id,
                    captured_at=last.captured_at,
                    provider=ImageryProviderRef(id=last.provider.id, name=last.provider.name)
                    if last.provider
                    else None,
                ),
                sources=version_sources,
                contours=version_contours,
            )
        )
    return reads


def owned_site_objects(db: Session, owner_id: uuid.UUID) -> list[StoredObject]:
    """Every stored file the sources of ``owner_id``'s sites name, for the account erasure: the
    owner cascade drops the rows before a sweep could read them."""
    rows = (
        db.query(Media)
        .join(Source, Source.id == Media.source_id)
        .join(Site, Site.id == Source.site_id)
        .filter(Site.owner_id == owner_id)
        .all()
    )
    return media_objects(rows)
