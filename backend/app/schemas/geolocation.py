import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

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
    # When the original source posted the media — distinct from ``event_date``
    # (when the event happened) and ``created_at`` (submission). Nullable.
    source_date: date | None = None
    created_at: datetime
    updated_at: datetime
    is_demo: bool
    # ``validated`` (human submits + bounty fulfilments) vs ``detected``
    # (machine-produced, rendered marked). See ``models.geolocation.STATE_*``.
    state: str
    # The post a machine detection was imported from — a provenance link
    # distinct from ``source_url`` (footage origin). NULL for human submits.
    detected_from_url: str | None = None
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
    # See ``GeolocationRead.state`` — a list card marks ``detected`` too.
    state: str
    author: AuthorRef
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class PaginatedGeolocations(BaseModel):
    items: list[GeolocationList]
    total: int
    page: int
    per_page: int


class GeolocationUpdate(BaseModel):
    """Owner edit of a ``detected`` geolocation (review flow).

    Partial update — the service applies only the fields the request actually
    carries (``model_dump(exclude_unset=True)``). The immutable fields on a
    detection (``source_url``, the source media, ``detected_from_url``,
    ``state``) have no field here, so they can't be expressed and can't be
    changed. ``source_date`` is the one nullable target: send it as ``null``
    to clear it, omit it to leave it untouched. The required-on-row fields
    (``title`` / ``lat`` / ``lng`` / ``event_date`` / ``proof``) are applied
    only when sent non-null. ``tag_ids`` replaces the tag set wholesale; ``[]``
    clears it.
    """

    title: str | None = Field(None, min_length=1, max_length=255)
    lat: float | None = None
    lng: float | None = None
    event_date: date | None = None
    source_date: date | None = None
    proof: dict[str, Any] | None = None
    tag_ids: list[uuid.UUID] | None = None


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
