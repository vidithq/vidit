import uuid
from datetime import UTC, date, datetime
from typing import Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.event import TITLE_MAX_LENGTH
from app.models.site import (
    OBSERVATION_EFFECT_DEFAULT,
    ImageryProvider,
    LinkEffect,
    ObservationEffect,
    SiteType,
)
from app.models.source import SOURCE_URL_MAX_LENGTH
from app.schemas.event import CoordsRead
from app.schemas.user import AuthorRef

NOTE_MAX_LENGTH = 2000
# Vertices across every ring of one zone; a hand-drawn site needs far fewer.
MAX_ZONE_VERTICES = 1000


class ZonePolygon(BaseModel):
    """A GeoJSON Polygon in WGS84: ``[lng, lat]`` positions, exterior ring first, each ring closed.

    Shape only; bounds and validity are checked by ``services/sites.zone_shape``.
    """

    type: Literal["Polygon"]
    coordinates: list[list[tuple[float, float]]] = Field(min_length=1)

    @field_validator("coordinates")
    @classmethod
    def _rings(cls, rings: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
        if sum(len(ring) for ring in rings) > MAX_ZONE_VERTICES:
            raise ValueError(f"a zone holds at most {MAX_ZONE_VERTICES} vertices")
        for ring in rings:
            if len(ring) < 4:
                raise ValueError("a ring needs at least 4 positions")
            if ring[0] != ring[-1]:
                raise ValueError("a ring must end on its first position")
        return rings


class SiteObservationCreate(BaseModel):
    """One dated zone and the imagery that proves it.

    ``imagery_url`` is required when ``imagery_provider`` is ``other``.
    ``captured_on`` may not be later than today (UTC).
    """

    zone: ZonePolygon
    captured_on: date
    imagery_provider: ImageryProvider
    imagery_url: str | None = Field(None, max_length=SOURCE_URL_MAX_LENGTH)
    effect: ObservationEffect = OBSERVATION_EFFECT_DEFAULT
    note: str | None = Field(None, max_length=NOTE_MAX_LENGTH)

    @field_validator("imagery_url", "note")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None

    @field_validator("imagery_url")
    @classmethod
    def _http_url(cls, v: str | None) -> str | None:
        if v is not None and not v.lower().startswith(("http://", "https://")):
            raise ValueError("must be an http or https URL")
        return v

    @model_validator(mode="after")
    def _reproducible(self) -> Self:
        if self.imagery_provider == "other" and self.imagery_url is None:
            raise ValueError("imagery_url is required when imagery_provider is 'other'")
        if self.captured_on > datetime.now(UTC).date():
            raise ValueError("captured_on may not be in the future")
        return self


class SiteCreate(BaseModel):
    """Body of ``POST /sites``: the site and its first observation, written together.

    ``name`` and ``site_type`` never change after the create.
    """

    name: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    site_type: SiteType
    observation: SiteObservationCreate

    @field_validator("name")
    @classmethod
    def _required_text(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class SiteOverlapCheck(BaseModel):
    """Body of ``POST /sites/overlaps``."""

    zone: ZonePolygon


class SiteOverlapRead(BaseModel):
    """A visible site whose current zone intersects the probed zone.

    Each share is the intersection area over one zone's area, from 0 to 1.
    """

    id: uuid.UUID
    name: str
    site_type: SiteType
    share_of_new_zone: float
    share_of_existing_zone: float


class SiteRef(BaseModel):
    id: uuid.UUID
    name: str
    site_type: SiteType


class SiteObservationRead(BaseModel):
    id: uuid.UUID
    zone: ZonePolygon
    captured_on: date
    imagery_provider: ImageryProvider
    imagery_url: str | None
    effect: ObservationEffect
    note: str | None
    author: AuthorRef | None
    created_at: datetime


class LatestLinkEffect(BaseModel):
    """The effect of the most recent visible linked event, by ``occurred_date``, on or before the
    read's date."""

    effect: LinkEffect
    occurred_date: date | None
    event_id: uuid.UUID


class SiteLinkedEventRead(BaseModel):
    """One visible event linked to the site.

    ``inside_zone`` and ``distance_m`` are measured against
    ``measured_observation_id``: the observation valid on ``occurred_date``, or the
    earliest one when the event predates them all, or the latest one when the
    event has no date. ``distance_m`` is null inside the zone.
    """

    id: uuid.UUID
    title: str
    occurred_date: date | None
    coords: CoordsRead
    owner: AuthorRef
    effect: LinkEffect
    linked_at: datetime
    inside_zone: bool
    distance_m: float | None
    measured_observation_id: uuid.UUID


class SiteState(BaseModel):
    """What every site read derives from the observations and the links.

    ``observed_on``, ``imagery_provider`` and ``observation_effect`` come from
    the observation valid at the read's date. ``corroboration_count`` counts
    the distinct owners of visible linked events; ``is_corroborated`` holds
    when one of them is not the site owner. ``latest_link_effect`` comes from
    the linked events dated on or before the read's date.
    """

    id: uuid.UUID
    name: str
    site_type: SiteType
    zone: ZonePolygon
    centroid: CoordsRead
    observed_on: date
    imagery_provider: ImageryProvider
    observation_effect: ObservationEffect
    corroboration_count: int
    is_corroborated: bool
    latest_link_effect: LatestLinkEffect | None


class SiteList(SiteState):
    """One site on the map, with the zone valid at ``as_of``."""

    owner_id: uuid.UUID


class SiteRead(SiteState):
    """The full site: its current zone and state, every observation oldest first,
    and every visible linked event oldest first."""

    owner: AuthorRef
    observations: list[SiteObservationRead]
    linked_events: list[SiteLinkedEventRead]
    created_at: datetime
    updated_at: datetime


class SiteCreatedRead(SiteRead):
    """``POST /sites`` answer: the new site and the visible sites its zone overlaps."""

    overlapping_sites: list[SiteOverlapRead]


class SiteNearbyEventRead(BaseModel):
    """A visible event within the margin of the current zone and not linked to the site."""

    id: uuid.UUID
    title: str
    occurred_date: date | None
    coords: CoordsRead
    owner: AuthorRef
    distance_m: float


class SiteSuggestionRead(SiteRef):
    """A site an event may link to; ``distance_m`` is from the event to the current zone."""

    distance_m: float | None


class EventSiteLinkCreate(BaseModel):
    site_id: uuid.UUID
    effect: LinkEffect


class EventSiteLinkRead(BaseModel):
    """One live link of an event to a site."""

    site: SiteRef
    effect: LinkEffect
    linked_at: datetime


SiteHistoryKind = Literal[
    "site_created",
    "observation_added",
    "event_linked",
    "event_unlinked",
    "link_effect_changed",
]


class SiteHistoryEvent(BaseModel):
    id: uuid.UUID
    title: str
    occurred_date: date | None


class SiteHistoryEntry(BaseModel):
    """One fact in a site's history, computed from the site, observation and link rows.

    ``recorded_at`` is when the fact entered Vidit. ``fact_date`` is when it happened on the
    ground: the imagery capture date of an observation, the event date of a link entry, null
    for ``site_created``. ``actor`` is null once that account is erased.

    Payload by kind: ``observation_added`` sets ``observation_id``, ``observation_effect`` and
    ``imagery_provider``; the three link kinds set ``event`` and ``link_effect``, and
    ``link_effect_changed`` also sets ``previous_link_effect``.
    """

    kind: SiteHistoryKind
    recorded_at: datetime
    fact_date: date | None
    actor: AuthorRef | None
    observation_id: uuid.UUID | None = None
    observation_effect: ObservationEffect | None = None
    imagery_provider: ImageryProvider | None = None
    event: SiteHistoryEvent | None = None
    link_effect: LinkEffect | None = None
    previous_link_effect: LinkEffect | None = None
