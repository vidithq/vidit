"""Sites: named areas of interest, their imagery history, their contours, and the events linked
to them.

Nothing about a site's state is stored. Four rules hold everywhere in this module:

* **A site image is a source** whose owner is the site (``sources.site_id``): a dated
  ``satellite`` capture, filed through ``services/events/sources.file_source`` and refused when
  no link lets a reader reopen it (``services/imagery.can_reopen``).
* **The zone valid on a date** is the contour whose image has the latest ``captured_at`` on or
  before it (:func:`zones_at`). The current zone is the one valid now.
* **What a site shows of an event** is one predicate,
  :func:`services.event_filters.site_linkable_events`, so an event that closes, is taken down
  or is soft-deleted leaves every read with no write to ``event_site_links``.
* **Corroboration** counts the distinct analysts who filed an image on the site or linked a
  visible event to it (:func:`_contributors`). Approvals never enter a site computation.
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
    exists,
    func,
    null,
    or_,
    select,
    true,
    union,
)
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from app.models.event import Event
from app.models.media import Media
from app.models.site import EventSiteLink, LinkEffect, Site, SiteContour, SiteVersion
from app.models.source import Source, SourceLink
from app.models.user import User
from app.schemas.event import CoordsRead
from app.schemas.site import (
    MAX_ZONE_AREA_KM2,
    MAX_ZONE_LNG_SPAN_DEG,
    EventSiteLinkRead,
    LatestLinkEffect,
    SiteContourCreate,
    SiteContourRead,
    SiteCreate,
    SiteHistoryEntry,
    SiteHistoryEvent,
    SiteImageCreate,
    SiteImageFiledRead,
    SiteImageRead,
    SiteLastImageRead,
    SiteLinkedEventRead,
    SiteList,
    SiteNearbyEventRead,
    SiteOverlapRead,
    SiteRead,
    SiteRecord,
    SiteRef,
    SiteSuggestionRead,
    SiteUpdate,
    ZonePolygon,
)
from app.schemas.source import ImageryProviderRead, ImageryProviderRef
from app.schemas.user import AuthorRef
from app.services.event_filters import lock_event, site_linkable_events, visible_events
from app.services.events import InvalidCoordinatesError, validate_coordinates
from app.services.events.errors import SourceMediaNotFoundError
from app.services.events.sources import build_source_read, file_source
from app.services.evidence_intake import StoredObject, media_objects
from app.services.imagery import LinkCheck, can_reopen, image_provider
from app.services.uploads import UPLOAD_ERROR_STATUS
from app.services.versions import MAX_VERSIONS_PER_EVENT, VersionLimitError

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


class NotSiteOwnerError(SiteError):
    """Only the site's owner edits its record or changes its contour."""

    code = "not_site_owner"


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


class SiteImageNotFoundError(SiteError):
    """A contour cites an image that is not one of the site's."""

    code = "site_image_not_found"


class ImageryNotReopenableError(SiteError):
    """No link of a site image lets a reader reopen it (``services/imagery.can_reopen``)."""

    code = "imagery_not_reopenable"


SITE_ERROR_STATUS: dict[str, int] = {
    **UPLOAD_ERROR_STATUS,
    "site_not_found": 404,
    "not_site_owner": 403,
    "not_event_owner": 403,
    "invalid_zone": 400,
    "zone_too_large": 400,
    "zone_too_wide": 400,
    "event_not_linkable": 409,
    "site_image_not_found": 400,
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


def live_links() -> ColumnElement[bool]:
    """A link row that is still in force. Every computed read filters on it."""
    return EventSiteLink.unlinked_at.is_(None)


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
    """One row per site: the contour valid on ``as_of``, or the current one when ``None``."""
    query = (
        select(
            SiteContour.id.label("contour_id"),
            SiteContour.site_id.label("site_id"),
            SiteContour.zone.label("zone"),
        )
        .join(Source, Source.id == SiteContour.source_id)
        .distinct(SiteContour.site_id)
    )
    if as_of is not None:
        query = query.where(_captured_date() <= as_of)
    return query.order_by(
        SiteContour.site_id, Source.captured_at.desc(), SiteContour.created_at.desc()
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


def _last_images(
    db: Session, site_ids: Sequence[uuid.UUID], as_of: date | None
) -> dict[uuid.UUID, SiteLastImageRead]:
    """Per site, the image with the latest capture on or before ``as_of``, with its provider."""
    if not site_ids:
        return {}
    query = (
        db.query(Source.id, Source.site_id, Source.captured_at)
        .filter(Source.site_id.in_(site_ids))
        .distinct(Source.site_id)
    )
    if as_of is not None:
        query = query.filter(_captured_date() <= as_of)
    rows = query.order_by(Source.site_id, Source.captured_at.desc(), Source.created_at.desc()).all()
    urls = _link_urls(db, [row.id for row in rows])
    last: dict[uuid.UUID, SiteLastImageRead] = {}
    for row in rows:
        provider = image_provider(urls[row.id])
        last[row.site_id] = SiteLastImageRead(
            id=row.id,
            captured_at=row.captured_at,
            provider=ImageryProviderRef.model_validate(provider) if provider else None,
        )
    return last


def _contributors(
    db: Session, site_ids: Sequence[uuid.UUID], as_of: date | None
) -> dict[uuid.UUID, set[uuid.UUID]]:
    """Per site, the analysts who filed an image captured on or before ``as_of``, or linked a
    visible event dated on or before it (an undated event counts at every date)."""
    if not site_ids:
        return {}
    images = select(Source.site_id.label("site_id"), Source.author_id.label("user_id")).where(
        Source.site_id.in_(site_ids), Source.author_id.is_not(None)
    )
    links = (
        select(EventSiteLink.site_id, EventSiteLink.linked_by_id)
        .join(Event, Event.id == EventSiteLink.event_id)
        .where(
            EventSiteLink.site_id.in_(site_ids),
            EventSiteLink.linked_by_id.is_not(None),
            live_links(),
            site_linkable_events(),
        )
    )
    if as_of is not None:
        images = images.where(_captured_date() <= as_of)
        links = links.where(or_(Event.occurred_date.is_(None), Event.occurred_date <= as_of))
    contributors: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for site_id, user_id in db.execute(union(images, links)):
        contributors[site_id].add(user_id)
    return contributors


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
    last_images = _last_images(db, site_ids, as_of)
    contributors = _contributors(db, site_ids, as_of)
    states: list[tuple[Site, dict[str, Any]]] = []
    for site, zone_json, lat, lng, contour_id, link_effect, link_date, link_event_id in rows:
        analysts = contributors.get(site.id, set())
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
                    "last_image": last_images.get(site.id),
                    "corroboration_count": len(analysts),
                    "is_corroborated": any(user_id != site.owner_id for user_id in analysts),
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


def _image_read(source: Source) -> SiteImageRead:
    provider = image_provider([link.url for link in source.links])
    return SiteImageRead(
        **build_source_read(source).model_dump(),
        provider=ImageryProviderRead.model_validate(provider) if provider else None,
        author=_actor(source.author),
        note=source.note,
        created_at=source.created_at,
    )


def _images(db: Session, criterion: ColumnElement[bool]) -> list[SiteImageRead]:
    rows = (
        db.query(Source)
        .options(
            selectinload(Source.links),
            selectinload(Source.tags),
            selectinload(Source.media),
            joinedload(Source.author),
        )
        .filter(Source.site_id.is_not(None), criterion)
        .order_by(Source.captured_at, Source.created_at, Source.id)
        .all()
    )
    return [_image_read(row) for row in rows]


def _contours(db: Session, criterion: ColumnElement[bool]) -> list[SiteContourRead]:
    rows = (
        db.query(SiteContour, func.ST_AsGeoJSON(SiteContour.zone), Source.captured_at)
        .join(Source, Source.id == SiteContour.source_id)
        .options(joinedload(SiteContour.author))
        .filter(criterion)
        .order_by(Source.captured_at, SiteContour.created_at, SiteContour.id)
        .all()
    )
    return [
        SiteContourRead(
            id=contour.id,
            zone=_geojson(zone_json),
            image_id=contour.source_id,
            captured_at=captured_at,
            author=_actor(contour.author),
            created_at=contour.created_at,
        )
        for contour, zone_json, captured_at in rows
    ]


def _linked_events(db: Session, site_id: uuid.UUID) -> list[SiteLinkedEventRead]:
    """Visible linked events, each measured against the contour valid on its date.

    The lateral pick orders the contours whose image is captured on or before ``occurred_date``
    (all of them for an undated event) latest first, then the later ones earliest first, and
    keeps the first row.
    """
    contour = aliased(SiteContour)
    image = aliased(Source)
    valid = or_(
        Event.occurred_date.is_(None), _captured_date(image.captured_at) <= Event.occurred_date
    )
    measured = (
        select(contour.id.label("contour_id"), contour.zone.label("zone"))
        .join(image, image.id == contour.source_id)
        .where(contour.site_id == site_id)
        .order_by(
            valid.desc(),
            case((valid, image.captured_at)).desc().nulls_last(),
            case((valid, contour.created_at)).desc().nulls_last(),
            image.captured_at.asc(),
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
            measured_contour_id=contour_id,
        )
        for event, effect, linked_at, lat, lng, contour_id, inside, distance in rows
    ]


def build_site_read(db: Session, site: Site) -> SiteRead:
    """The full read of one site: current state, images, contours and linked events."""
    ((_, state),) = _site_states(db, as_of=None, criteria=[Site.id == site.id], limit=1)
    return SiteRead(
        **state,
        owner=site.owner,
        hidden_at=site.hidden_at,
        images=_images(db, Source.site_id == site.id),
        contours=_contours(db, SiteContour.site_id == site.id),
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


def _event_file(db: Session, media_id: uuid.UUID) -> Media:
    """The file of a satellite source of a published, visible event, to copy onto a site image.
    A graphic source's file is refused: a site image carries no graphic cover."""
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
        raise SourceMediaNotFoundError(f"An image names a file that does not exist: {media_id}")
    return media


def _file_image(db: Session, *, site_id: uuid.UUID, author: User, body: SiteImageCreate) -> Source:
    """Stage one site image, refused when no link reopens it. Flushed, not committed."""
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
            "No link lets a reader reopen this image. Link a permalink from an accepted imagery "
            "provider, or archive the publication that shows the image."
        )
    db.flush()
    return source


def _duplicates(db: Session, image: Source) -> list[uuid.UUID]:
    """The other images of the site with the same provider and the same capture day."""
    provider = image_provider([link.url for link in image.links])
    if provider is None or image.captured_at is None:
        return []
    candidates = (
        db.query(Source.id)
        .filter(
            Source.site_id == image.site_id,
            Source.id != image.id,
            _captured_date() == image.captured_at.astimezone(UTC).date(),
        )
        .all()
    )
    urls = _link_urls(db, [row.id for row in candidates])
    return [
        row.id
        for row in candidates
        if (other := image_provider(urls[row.id])) is not None and other.id == provider.id
    ]


def create_site(
    db: Session, *, owner: User, body: SiteCreate
) -> tuple[Site, list[SiteOverlapRead]]:
    """Write a site, its first image and the contour that image shows, in one transaction.

    The overlap check runs first and never blocks the create.
    """
    overlaps = find_overlaps(db, body.contour)
    try:
        site = Site(owner_id=owner.id, name=body.name, kind=body.kind)
        db.add(site)
        db.flush()
        image = _file_image(db, site_id=site.id, author=owner, body=body.image)
        db.add(
            SiteContour(
                site_id=site.id,
                source_id=image.id,
                author_id=owner.id,
                zone=zone_shape(db, body.contour),
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(site)
    return site, overlaps


def file_image(
    db: Session, *, site: Site, author: User, body: SiteImageCreate
) -> SiteImageFiledRead:
    """File one image in ``site``'s imagery history. Any signed-in analyst may.

    An image already filed with the same provider and capture day is flagged in
    ``duplicate_image_ids``, never refused.
    """
    try:
        image = _file_image(db, site_id=site.id, author=author, body=body)
        duplicates = _duplicates(db, image)
        db.commit()
    except Exception:
        db.rollback()
        raise
    (read,) = _images(db, Source.id == image.id)
    return SiteImageFiledRead(**read.model_dump(), duplicate_image_ids=duplicates)


def change_contour(
    db: Session, *, site: Site, user: User, body: SiteContourCreate
) -> SiteContourRead:
    """Draw a new contour of ``site``, citing one of its images. The owner only."""
    _require_site_owner(site, user)
    geometry = zone_shape(db, body.zone)
    cited = db.query(exists().where(Source.id == body.image_id, Source.site_id == site.id)).scalar()
    if not cited:
        raise SiteImageNotFoundError("The contour must cite an image of this site")
    contour = SiteContour(
        site_id=site.id, source_id=body.image_id, author_id=user.id, zone=geometry
    )
    db.add(contour)
    db.commit()
    (read,) = _contours(db, SiteContour.id == contour.id)
    return read


def edit_site(db: Session, *, site: Site, user: User, body: SiteUpdate) -> Site:
    """Change the site's name or kind, filing the state it supersedes. The owner only.

    The site row lock takes the version number. A body that changes nothing files nothing.
    Raises ``VersionLimitError`` past the event ceiling of versions.
    """
    _require_site_owner(site, user)
    locked = db.query(Site).filter(Site.id == site.id).populate_existing().with_for_update().one()
    changes = {
        field: value
        for field, value in (("name", body.name), ("kind", body.kind))
        if value is not None and value != getattr(locked, field)
    }
    if not changes:
        db.commit()
        return locked
    if locked.version_no >= MAX_VERSIONS_PER_EVENT:
        db.rollback()
        raise VersionLimitError(
            f"This site has reached {MAX_VERSIONS_PER_EVENT} versions and can no longer be edited."
        )
    db.add(
        SiteVersion(
            site_id=locked.id,
            version_no=locked.version_no,
            edited_by_id=user.id,
            snapshot=SiteRecord(name=locked.name, kind=locked.kind).model_dump(),
        )
    )
    locked.version_no += 1
    for field, value in changes.items():
        setattr(locked, field, value)
    db.commit()
    db.refresh(locked)
    return locked


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


def _require_event_owner(event: Event, user: User) -> None:
    if event.owner_id != user.id:
        raise NotEventOwnerError("Only the event's owner links it to a site")


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
    _require_event_owner(event, user)
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
    _require_event_owner(event, user)
    lock_event(db, event.id)
    live = _live_link(db, event_id=event.id, site_id=site_id)
    if live is not None:
        live.unlinked_at = datetime.now(UTC)
        live.unlinked_by_id = user.id
    db.commit()


def _utc_day(instant: datetime) -> date:
    return instant.astimezone(UTC).date()


def _fact_order(entry: SiteHistoryEntry) -> tuple[date, datetime]:
    """A record-only entry happened, on the ground, on the day it was recorded."""
    return (entry.fact_date or _utc_day(entry.recorded_at), entry.recorded_at)


def _record_entries(db: Session, site: Site) -> tuple[SiteRecord, list[SiteHistoryEntry]]:
    """The record the site was created with, and one ``record_edited`` entry per edit."""
    filed = (
        db.query(SiteVersion)
        .options(joinedload(SiteVersion.edited_by))
        .filter(SiteVersion.site_id == site.id)
        .order_by(SiteVersion.version_no)
        .all()
    )
    records = [SiteRecord.model_validate(row.snapshot) for row in filed]
    records.append(SiteRecord(name=site.name, kind=site.kind))
    entries = [
        SiteHistoryEntry(
            kind="record_edited",
            recorded_at=row.created_at,
            fact_date=None,
            actor=_actor(row.edited_by),
            previous_record=before,
            record=after,
        )
        for row, before, after in zip(filed, records[:-1], records[1:], strict=True)
    ]
    return records[0], entries


def _link_entries(db: Session, site: Site) -> list[SiteHistoryEntry]:
    """Every link, unlink and effect change, naming visible events only."""
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
    entries: list[SiteHistoryEntry] = []
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
                    actor=_actor(successor.linked_by),
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
                    actor=_actor(link.unlinked_by),
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
                    actor=_actor(link.linked_by),
                    event=event,
                    link_effect=link.effect,
                )
            )
    return entries


def site_history(db: Session, *, site: Site, order: str) -> list[SiteHistoryEntry]:
    """The site's history, computed from its record versions, images, contours and links.

    ``order`` is ``fact`` (by ``fact_date``, ``recorded_at`` breaking ties) or ``recorded``.
    Link entries name visible events only, so a withheld or deleted event leaves the history.
    """
    images = (
        db.query(Source)
        .options(joinedload(Source.author))
        .filter(Source.site_id == site.id)
        .order_by(Source.created_at, Source.id)
        .all()
    )
    contours = (
        db.query(SiteContour, Source.captured_at)
        .join(Source, Source.id == SiteContour.source_id)
        .options(joinedload(SiteContour.author))
        .filter(SiteContour.site_id == site.id)
        .order_by(SiteContour.created_at, SiteContour.id)
        .all()
    )
    first_record, entries = _record_entries(db, site)
    first_contour = contours[0][0]
    entries.append(
        SiteHistoryEntry(
            kind="site_created",
            recorded_at=site.created_at,
            fact_date=None,
            actor=_actor(site.owner),
            record=first_record,
            image_id=first_contour.source_id,
            contour_id=first_contour.id,
        )
    )
    entries += [
        SiteHistoryEntry(
            kind="image_filed",
            recorded_at=image.created_at,
            fact_date=_utc_day(image.captured_at) if image.captured_at else None,
            actor=_actor(image.author),
            image_id=image.id,
        )
        for image in images
    ]
    entries += [
        SiteHistoryEntry(
            kind="contour_changed",
            recorded_at=contour.created_at,
            fact_date=_utc_day(captured_at),
            actor=_actor(contour.author),
            contour_id=contour.id,
            image_id=contour.source_id,
        )
        for contour, captured_at in contours[1:]
    ]
    entries += _link_entries(db, site)
    if order == "recorded":
        entries.sort(key=lambda entry: entry.recorded_at)
    else:
        entries.sort(key=_fact_order)
    return entries


def owned_site_objects(db: Session, owner_id: uuid.UUID) -> list[StoredObject]:
    """Every stored file the images of ``owner_id``'s sites name, for the account erasure: the
    owner cascade drops the rows before a sweep could read them."""
    rows = (
        db.query(Media)
        .join(Source, Source.id == Media.source_id)
        .join(Site, Site.id == Source.site_id)
        .filter(Site.owner_id == owner_id)
        .all()
    )
    return media_objects(rows)
