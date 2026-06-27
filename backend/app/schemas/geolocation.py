import uuid
from datetime import date, datetime, time
from typing import Any

from pydantic import BaseModel

from app.models.geolocation import GeolocationStatus
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class _OriginatedFromBountyNested(BaseModel):
    """Compact bounty trace surfaced on the geolocation detail.

    Enough to render "originally posted as a bounty by @x" with a click-through;
    the full bounty row is one extra fetch when the reader wants it.
    """

    id: uuid.UUID
    title: str
    author: AuthorRef

    model_config = {"from_attributes": True}


class GeolocationRead(BaseModel):
    id: uuid.UUID
    title: str
    lat: float
    lng: float
    source_url: str
    proof: dict[str, Any] | None
    event_date: date
    # Optional time-of-day for ``event_date`` (UTC); NULL when the hour is unknown.
    event_time: time | None = None
    # When the original source posted the media — a real post instant (UTC),
    # always present. Distinct from ``event_date`` (when the event happened) and
    # ``created_at`` (submission).
    source_posted_at: datetime
    created_at: datetime
    updated_at: datetime
    is_demo: bool
    # ``submitted`` (human submits + bounty fulfilments) vs ``detected``
    # (machine-produced, rendered marked). See ``models.geolocation.STATUS_*``.
    status: GeolocationStatus
    # The post a machine detection was imported from, a provenance link
    # distinct from ``source_url`` (footage origin). NULL for human submits.
    detected_from_url: str | None = None
    # When the analyst posted this geolocation on X (the imported tweet's time);
    # NULL for human submits. The "who geolocated first" precedence signal.
    detected_post_at: datetime | None = None
    author: AuthorRef
    media: list[MediaRead]
    tags: list[TagRead]
    originated_from_bounty: _OriginatedFromBountyNested | None = None

    model_config = {"from_attributes": True}


class GeolocationList(BaseModel):
    id: uuid.UUID
    title: str
    lat: float
    lng: float
    event_date: date
    is_demo: bool
    # See ``GeolocationRead.status``; a list card marks ``detected`` too.
    status: GeolocationStatus
    author: AuthorRef
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class PaginatedGeolocations(BaseModel):
    items: list[GeolocationList]
    total: int
    page: int
    per_page: int


class PaginatedGeolocationDetails(BaseModel):
    """Full-detail paginated geolocations: the owner Detections-queue payload.

    Mirrors ``PaginatedGeolocations`` but carries ``GeolocationRead`` items
    (media + tags + provenance) rather than the lightweight ``GeolocationList``
    card: the Detections queue needs the media to judge a detection and the tags
    to compute submit-readiness (>=1 media + a ``conflict`` + a
    ``capture_source`` tag) without a per-row round-trip.
    """

    items: list[GeolocationRead]
    total: int
    page: int
    per_page: int


class PossibleDuplicateRead(BaseModel):
    """Soft-warning hit on the submit form's possible-duplicate probe.

    Just the bits the analyst needs to recognise "that's the same event" and
    decide whether to abandon their in-progress submission. The full detail page
    is one click away for the proof body / media.
    """

    id: uuid.UUID
    title: str
    lat: float
    lng: float
    event_date: date
    source_url: str
    # Geodesic distance in metres from the caller-supplied (lat, lng). Float
    # (not int) so the frontend renders "120 m" vs "0.4 km" without rounding
    # artefacts at small distances.
    distance_m: float
    author: AuthorRef

    model_config = {"from_attributes": True}
