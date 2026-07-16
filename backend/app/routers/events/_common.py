"""Shared helpers for the events sub-routers.

What the ``read`` / ``write`` / ``item`` sub-routers all need, kept here so
none imports another:

* the typed-error → HTTP envelope (``_raise_event_error`` over the
  ``code → status`` map),
* :func:`build_event_read`, the single ``EventRead`` assembler shared by
  create, detail, and the lifecycle mutations, and
* the small projection helpers (:func:`coords_or_none`, :func:`source_media`)
  every serializer leans on.
"""

from typing import NoReturn

from app.models.event import Event
from app.models.media import Media
from app.routers._errors import raise_typed_error
from app.schemas.event import CoordsRead, EventRead
from app.schemas.media import MediaRead
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError

_EVENT_ERROR_STATUS: dict[str, int] = {
    **EVIDENCE_INTAKE_ERROR_STATUS,
    "invalid_coordinates": 400,
    "invalid_proof": 400,
    "proof_image_required": 400,
    "source_url_required": 400,
    "tag_requirements_not_met": 400,
    "invalid_state": 409,
}


def _raise_event_error(exc: EvidenceIntakeError) -> NoReturn:
    """Translate a typed events-service error into an HTTP response."""
    raise_typed_error(exc, _EVENT_ERROR_STATUS)


def coords_or_none(lat: float | None, lng: float | None) -> CoordsRead | None:
    """Fold a projected ``(lat, lng)`` pair into the nested wire shape.

    A PostGIS point projects to two floats or two NULLs; half a pair never
    occurs, so ``None`` on either side means "no point".
    """
    if lat is None or lng is None:
        return None
    return CoordsRead(lat=lat, lng=lng)


def source_media(geo: Event) -> MediaRead | None:
    """The event's single ``source`` media as its wire shape, or None.

    The ``media`` relationship carries proof rows too since the roles merge;
    every card thumbnail must pick through this so a proof image can't
    masquerade as the footage.
    """
    row: Media | None = next((m for m in geo.media if m.role == "source"), None)
    return MediaRead.model_validate(row) if row is not None else None


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
    inside the proof JSON as URLs.
    """
    return EventRead(
        id=geo.id,
        title=geo.title,
        event_coords=coords_or_none(lat, lng),
        capture_source_coords=coords_or_none(capture_lat, capture_lng),
        source_url=geo.source_url,
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
        tags=geo.tags,
    )
