"""Shared helpers for the geolocations sub-routers.

Two things the ``write`` and ``item`` sub-routers both need, kept here so neither
imports the other:

* the typed-error → HTTP envelope (``_raise_geolocation_error`` over the
  ``code → status`` map), and
* :func:`build_geolocation_read`, the single ``GeolocationRead`` assembler shared
  by create, detail, and the review-flow mutations.
"""

from typing import NoReturn

from app.models.geolocation import Geolocation
from app.routers._errors import raise_typed_error
from app.schemas.geolocation import GeolocationRead
from app.services.evidence_intake import EVIDENCE_INTAKE_ERROR_STATUS, EvidenceIntakeError

_GEOLOCATION_ERROR_STATUS: dict[str, int] = {
    **EVIDENCE_INTAKE_ERROR_STATUS,
    "invalid_coordinates": 400,
    "invalid_proof": 400,
    "tag_requirements_not_met": 400,
    "invalid_state": 409,
}


def _raise_geolocation_error(exc: EvidenceIntakeError) -> NoReturn:
    """Translate a typed geolocations-service error into an HTTP response."""
    raise_typed_error(exc, _GEOLOCATION_ERROR_STATUS)


def build_geolocation_read(
    geo: Geolocation,
    *,
    lat: float | None,
    lng: float | None,
) -> GeolocationRead:
    """Assemble the ``GeolocationRead`` response for one event.

    ``lat`` / ``lng`` are passed in (re-projected from the PostGIS point by the
    caller, or already in hand from a create) rather than re-queried here, so the
    response sites — create, detail, and the review-flow mutations — build an
    identical shape from one place. They are ``None`` for a ``requested`` event
    (no coordinates yet). ``requested_by`` reads off the model relationship
    (``None`` for a directly-submitted geolocation); callers eager-load it.
    """
    return GeolocationRead(
        id=geo.id,
        title=geo.title,
        lat=lat,
        lng=lng,
        source_url=geo.source_url,
        proof=geo.proof,
        event_date=geo.event_date,
        event_time=geo.event_time,
        source_posted_at=geo.source_posted_at,
        created_at=geo.created_at,
        updated_at=geo.updated_at,
        is_demo=geo.is_demo,
        status=geo.status,
        detected_from_url=geo.detected_from_url,
        detected_post_at=geo.detected_post_at,
        author=geo.author,
        requested_by=geo.requested_by,
        media=geo.media,
        tags=geo.tags,
    )
