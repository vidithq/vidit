"""Shared helpers for the events sub-routers.

What the ``read`` / ``write`` / ``item`` sub-routers all need, kept here so
none imports another:

* the typed-error → HTTP envelope (``_raise_event_error`` over the
  ``code → status`` map),
* :func:`build_event_read` and :func:`build_event_list`, the single
  ``EventRead`` / ``EventList`` assemblers shared by every response site
  (including the users and social routers, which import from here), and
* the small projection helpers (:func:`coords_or_none`, :func:`thumbnail_media`)
  every serializer leans on, and :func:`resolve_live_event`, the by-id fetch
  the ``item`` and ``archives`` sub-routers share.
"""

import uuid
from typing import Annotated, NoReturn

from fastapi import HTTPException
from pydantic import StringConstraints
from sqlalchemy.orm import Session

from app.models.event import SOURCE_URL_MAX_LENGTH, Event
from app.routers._errors import raise_typed_error
from app.schemas.event import ArchivedLinkRead, CoordsRead, EventList, EventRead
from app.schemas.media import MediaRead
from app.schemas.user import AuthorRef
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError
from app.services.source_archive import archive_row_for
from app.services.thumbnails import pick_thumbnail

# Item type of the repeated ``secondary_source_urls`` multipart field, shared by
# the create / request / geolocate forms. The ceiling rides on the ITEM: a
# ``max_length`` on the ``list[str]`` parameter would cap how many entries the
# form accepts, not how long each URL may be.
SecondarySourceUrl = Annotated[str, StringConstraints(max_length=SOURCE_URL_MAX_LENGTH)]

_EVENT_ERROR_STATUS: dict[str, int] = {
    **EVIDENCE_INTAKE_ERROR_STATUS,
    "event_not_found": 404,
    "coordinates_required": 400,
    "invalid_coordinates": 400,
    "invalid_proof": 400,
    "proof_image_required": 400,
    "source_url_required": 400,
    "tag_requirements_not_met": 400,
    "too_many_source_links": 400,
    "invalid_state": 409,
}


def _raise_event_error(exc: EvidenceIntakeError) -> NoReturn:
    """Translate a typed events-service error into an HTTP response."""
    raise_typed_error(exc, _EVENT_ERROR_STATUS)


def resolve_live_event(db: Session, event_id: uuid.UUID) -> Event:
    """Fetch a live event by id, or 404.

    A soft-deleted row reads as 404 (an admin-removed row isn't actionable, the
    same surface as a genuine 404, no enumeration oracle). Permission is the
    caller's concern: the geolocate transition owns per-status ownership (a
    ``requested`` event is answerable by anyone), while the owner-only verbs
    call ``permissions.ensure_owner`` themselves.
    """
    geo = db.query(Event).filter(Event.id == event_id, Event.deleted_at.is_(None)).first()
    if geo is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return geo


def coords_or_none(lat: float | None, lng: float | None) -> CoordsRead | None:
    """Fold a projected ``(lat, lng)`` pair into the nested wire shape.

    A PostGIS point projects to two floats or two NULLs; half a pair never
    occurs, so ``None`` on either side means "no point".
    """
    if lat is None or lng is None:
        return None
    return CoordsRead(lat=lat, lng=lng)


def thumbnail_media(geo: Event) -> MediaRead | None:
    """The event's card thumbnail as its wire shape, or None.

    Delegates the pick to ``services.thumbnails.pick_thumbnail`` (first
    ``source`` row, else first ``proof`` image), the one home for the rule.
    """
    row = pick_thumbnail(geo.media)
    return MediaRead.model_validate(row) if row is not None else None


def build_event_list(
    geo: Event,
    *,
    lat: float | None,
    lng: float | None,
    investigator_count: int | None = None,
    investigators_sample: list[AuthorRef] | None = None,
) -> EventList:
    """Assemble the ``EventList`` card for one event.

    The list-payload twin of :func:`build_event_read`, shared by every paged
    surface (the events index, a user's geolocations, the follow timeline) so
    a card is the same shape wherever it renders. Coordinates come in
    re-projected by the caller, same contract as :func:`build_event_read`.
    The investigator aggregates default to ``None``: only the requested view
    computes them (see ``services.events.investigator_aggregates``).
    """
    return EventList(
        id=geo.id,
        title=geo.title,
        event_coords=coords_or_none(lat, lng),
        event_date=geo.event_date,
        is_demo=geo.is_demo,
        status=geo.status,
        before_closed_status=geo.before_closed_status,
        owner=geo.owner,
        media=thumbnail_media(geo),
        tags=geo.tags,
        conflicts=geo.conflicts,
        investigator_count=investigator_count,
        investigators_sample=investigators_sample,
    )


def _archived_link(geo: Event, url: str | None) -> ArchivedLinkRead | None:
    """One link's archived copy as wire shape, or ``None`` when it has none.

    The one place the stored row becomes wire shape, so the primary source, the
    provenance link and every mirror serialise identically. ``None`` is the
    ordinary state: a copy exists only where the owner recorded one.
    """
    row = archive_row_for(geo, url)
    if row is None:
        return None
    return ArchivedLinkRead(url=row.snapshot_url, provider=row.provider)


def build_event_read(
    geo: Event,
    *,
    lat: float | None,
    lng: float | None,
    capture_lat: float | None = None,
    capture_lng: float | None = None,
) -> EventRead:
    """Assemble the ``EventRead`` response for one event.

    Coordinates are passed in (re-projected from the PostGIS points by the
    caller, or already in hand from a create) rather than re-queried here, so
    the response sites (create, detail, and the lifecycle mutations) build an
    identical shape from one place. ``requested_by`` reads off the model
    relationship (``None`` for a directly-submitted geolocation); callers
    eager-load it along with ``geolocators`` / ``investigators`` and their
    users. ``media`` carries only the ``source`` rows: proof images travel
    inside the proof JSON as URLs. ``thumbnail`` is the card pick
    (``services.thumbnails``), which may be a proof image on a source-less
    event; callers that want it non-null on such rows must eager-load media
    with ``thumbnail_media_criteria``.
    """
    return EventRead(
        id=geo.id,
        title=geo.title,
        event_coords=coords_or_none(lat, lng),
        capture_source_coords=coords_or_none(capture_lat, capture_lng),
        source_url=geo.source_url,
        # Reads the eager-loaded ``archives`` collection; callers that skip
        # that load pay a lazy query per event, so every detail loader carries
        # it (see ``_DETAIL_LOADS``).
        archived_source=_archived_link(geo, geo.source_url),
        # Ordered by the relationship's ``position``, so the read order is the
        # order the submitter gave.
        secondary_source_urls=[link.url for link in geo.source_links],
        # Built from the same walk, so the two lists stay index-aligned by
        # construction. Reads the same eager-loaded ``archives`` collection as
        # ``archived_source``, so a mirror costs no extra query.
        archived_secondary_sources=[_archived_link(geo, link.url) for link in geo.source_links],
        proof=geo.proof,
        event_date=geo.event_date,
        event_time=geo.event_time,
        source_posted_at=geo.source_posted_at,
        created_at=geo.created_at,
        updated_at=geo.updated_at,
        requested_at=geo.requested_at,
        detected_at=geo.detected_at,
        geolocated_at=geo.geolocated_at,
        closed_at=geo.closed_at,
        is_demo=geo.is_demo,
        status=geo.status,
        close_reason=geo.close_reason,
        before_closed_status=geo.before_closed_status,
        detected_from_url=geo.detected_from_url,
        # Same eager-loaded collection as the source and the mirrors, so the
        # provenance row costs no extra query either.
        archived_detected_from=_archived_link(geo, geo.detected_from_url),
        detected_post_at=geo.detected_post_at,
        owner=geo.owner,
        # Null a soft-deleted requester so a banned account never surfaces in the
        # requested_by slot of a still-live event owned by someone else (the
        # owner's own soft-delete cascade-hides their events; the requester's does
        # not, so it is guarded here).
        requested_by=(
            geo.requested_by
            if geo.requested_by is not None and geo.requested_by.deleted_at is None
            else None
        ),
        # Pydantic ``from_attributes`` coerces each SQLAlchemy ``User`` into
        # ``AuthorRef`` at validation time. Drop soft-deleted contributors for
        # the same reason as ``requested_by`` above: a banned account must not
        # surface as a credited geolocator or an active investigator on a
        # still-live event owned by someone else.
        geolocators=[g.user for g in geo.geolocators if g.user.deleted_at is None],
        investigator_count=sum(1 for i in geo.investigators if i.user.deleted_at is None),
        investigators=[i.user for i in geo.investigators if i.user.deleted_at is None],
        media=[m for m in geo.media if m.role == "source"],
        thumbnail=thumbnail_media(geo),
        tags=geo.tags,
        conflicts=geo.conflicts,
    )
