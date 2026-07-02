import uuid
from datetime import date, datetime, time
from typing import Any

from pydantic import BaseModel

from app.models.geolocation import GeolocationStatus
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class ArchiveImportResult(BaseModel):
    """Outcome of an archive backfill: how the detections landed.

    The assemble counts. ``created`` is new ``detected`` rows; ``skipped`` a pair
    a live row already held; ``recreated`` a previously rejected (soft-deleted)
    pair re-detected; ``failed`` a detection that raised mid-persist and was
    rolled back (the others still land).
    """

    created: int
    skipped: int
    recreated: int
    failed: int


class GeolocationRead(BaseModel):
    id: uuid.UUID
    title: str
    # Optional: a ``requested`` event has no coordinates yet (``location`` is
    # NULL), and this same read serves the requested view. Present for every
    # ``geolocated`` row, and for a located ``detected`` one.
    lat: float | None = None
    lng: float | None = None
    source_url: str
    proof: dict[str, Any] | None
    event_date: date | None = None
    # Optional time-of-day for ``event_date`` (UTC); NULL when the hour is unknown.
    event_time: time | None = None
    # When the original source posted the media: a real post instant (UTC),
    # always present. Distinct from ``event_date`` (when the event happened) and
    # ``created_at`` (submission).
    source_posted_at: datetime
    created_at: datetime
    updated_at: datetime
    is_demo: bool
    # The 4-value lifecycle: ``requested`` / ``detected`` / ``geolocated`` /
    # ``closed``. See ``models.geolocation.STATUS_*``.
    status: GeolocationStatus
    # The post a machine detection was imported from, a provenance link
    # distinct from ``source_url`` (footage origin). NULL for human submits.
    detected_from_url: str | None = None
    # When the analyst posted this geolocation on X (the imported tweet's time);
    # NULL for human submits. The "who geolocated first" precedence signal.
    detected_post_at: datetime | None = None
    author: AuthorRef
    # Who opened the request, preserved across fulfilment. NULL for a
    # directly-submitted geolocation (no request preceded it).
    requested_by: AuthorRef | None = None
    media: list[MediaRead]
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class GeolocationList(BaseModel):
    id: uuid.UUID
    title: str
    # Optional for the same reason as ``GeolocationRead.lat`` / ``lng``.
    lat: float | None = None
    lng: float | None = None
    event_date: date | None = None
    is_demo: bool
    # See ``GeolocationRead.status``; a list card marks ``detected`` too.
    status: GeolocationStatus
    author: AuthorRef
    # The card thumbnail: the geolocation's first media row, None when it has
    # none. One media on purpose so the list payload stays light; the full set
    # lives on ``GeolocationRead.media``. Required (no default) so a
    # constructor can't silently omit it and ship a false "no media".
    media: MediaRead | None
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
    # A duplicate candidate is always a located row (the proximity predicate
    # skips NULL-location rows), so coordinates are always present; the event
    # date is nullable, as it is often unknown for a machine detection.
    lat: float
    lng: float
    event_date: date | None = None
    source_url: str
    # Geodesic distance in metres from the caller-supplied (lat, lng). Float
    # (not int) so the frontend renders "120 m" vs "0.4 km" without rounding
    # artefacts at small distances.
    distance_m: float
    author: AuthorRef

    model_config = {"from_attributes": True}
