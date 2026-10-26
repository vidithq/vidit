import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models.event import TITLE_MAX_LENGTH
from app.models.site import LinkEffect, SiteKind
from app.models.source import SOURCE_TITLE_MAX_LENGTH
from app.schemas.event import CoordsRead
from app.schemas.source import (
    LIST_PARSE_CEILING,
    ImageryProviderRead,
    ImageryProviderRef,
    SourceLinkCreate,
    SourceRead,
    UtcDatetime,
)
from app.schemas.user import AuthorRef

IMAGE_NOTE_MAX_LENGTH = 500
# Vertices across every ring of one zone; a hand-drawn site needs far fewer.
MAX_ZONE_VERTICES = 1000
# A zone covers a site, not a region: its geography area stays under this cap.
MAX_ZONE_AREA_KM2 = 10_000
# A longitude span of 180 degrees or more would let a zone wrap the antimeridian.
MAX_ZONE_LNG_SPAN_DEG = 180

SiteName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TITLE_MAX_LENGTH)
]


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


class SiteImageCreate(BaseModel):
    """One dated satellite image filed on a site.

    The links are where a reader reopens the image (``services/imagery``). The file is one of
    ``upload_id`` (a staged file from ``POST /uploads``) and ``media_id`` (the file of a
    satellite source of a published event), or neither.
    """

    model_config = ConfigDict(extra="forbid")

    title: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=SOURCE_TITLE_MAX_LENGTH)
    ] = ""
    captured_at: UtcDatetime
    links: list[SourceLinkCreate] = Field(default_factory=list, max_length=LIST_PARSE_CEILING)
    upload_id: uuid.UUID | None = None
    media_id: uuid.UUID | None = None
    note: str | None = Field(None, max_length=IMAGE_NOTE_MAX_LENGTH)

    @field_validator("note")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None

    @model_validator(mode="after")
    def _one_file_and_a_past_capture(self) -> Self:
        if self.upload_id is not None and self.media_id is not None:
            raise ValueError("An image carries one file: send upload_id or media_id, not both")
        if self.captured_at > datetime.now(UTC):
            raise ValueError("captured_at may not be in the future")
        return self


class SiteCreate(BaseModel):
    """Body of ``POST /sites``: the record, the first image and the contour it shows."""

    name: SiteName
    kind: SiteKind
    contour: ZonePolygon
    image: SiteImageCreate


class SiteUpdate(BaseModel):
    """Body of ``PATCH /sites/{id}``: the fields to change, at least one."""

    name: SiteName | None = None
    kind: SiteKind | None = None

    @model_validator(mode="after")
    def _something(self) -> Self:
        if self.name is None and self.kind is None:
            raise ValueError("send name, kind or both")
        return self


class SiteContourCreate(BaseModel):
    """Body of ``POST /sites/{id}/contours``: a zone and the site image that shows it."""

    zone: ZonePolygon
    image_id: uuid.UUID


class SiteOverlapCheck(BaseModel):
    """Body of ``POST /sites/overlaps``."""

    zone: ZonePolygon


class SiteRef(BaseModel):
    id: uuid.UUID
    name: str
    kind: SiteKind


class SiteOverlapRead(SiteRef):
    """A visible site whose current zone intersects the probed zone.

    Each share is the intersection area over one zone's area, from 0 to 1.
    """

    share_of_new_zone: float
    share_of_existing_zone: float


class SiteImageRead(SourceRead):
    """One image of a site's imagery history: the source, its provider, analyst and note."""

    provider: ImageryProviderRead | None
    author: AuthorRef | None
    note: str | None
    created_at: datetime


class SiteImageFiledRead(SiteImageRead):
    """``POST /sites/{id}/images`` answer: the image, and the images already filed on the site
    with the same provider and capture date."""

    duplicate_image_ids: list[uuid.UUID]


class SiteContourRead(BaseModel):
    """One contour the owner drew; ``captured_at`` is its image's, the date it holds from."""

    id: uuid.UUID
    zone: ZonePolygon
    image_id: uuid.UUID
    captured_at: datetime
    author: AuthorRef | None
    created_at: datetime


class SiteLastImageRead(BaseModel):
    id: uuid.UUID
    captured_at: datetime
    provider: ImageryProviderRef | None


class LatestLinkEffect(BaseModel):
    """The effect of the most recent visible linked event, by ``occurred_date``, on or before the
    read's date."""

    effect: LinkEffect
    occurred_date: date | None
    event_id: uuid.UUID


class SiteLinkedEventRead(BaseModel):
    """One visible event linked to the site.

    ``inside_zone`` and ``distance_m`` are measured against ``measured_contour_id``: the
    contour valid on ``occurred_date``, the earliest one when the event predates them all, or
    the current one when the event has no date. ``distance_m`` is null inside the zone.
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
    measured_contour_id: uuid.UUID


class SiteState(BaseModel):
    """What every site read derives from the contours, the images and the links, at the read's
    date.

    ``corroboration_count`` counts the distinct analysts who filed an image on the site or
    linked a visible event to it; ``is_corroborated`` holds when one of them is not the owner.
    """

    id: uuid.UUID
    name: str
    kind: SiteKind
    zone: ZonePolygon
    centroid: CoordsRead
    contour_id: uuid.UUID
    last_image: SiteLastImageRead | None
    corroboration_count: int
    is_corroborated: bool
    latest_link_effect: LatestLinkEffect | None


class SiteList(SiteState):
    """One site on the map, read at ``as_of``."""

    owner_id: uuid.UUID


class SiteRead(SiteState):
    """The full site: its current state, every image and contour, oldest capture first, and every
    visible linked event, oldest first. ``hidden_at`` is set only on a withheld site, which only
    an admin reads."""

    owner: AuthorRef
    hidden_at: datetime | None
    images: list[SiteImageRead]
    contours: list[SiteContourRead]
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
    "image_filed",
    "contour_changed",
    "record_edited",
    "event_linked",
    "event_unlinked",
    "link_effect_changed",
]


class SiteHistoryEvent(BaseModel):
    id: uuid.UUID
    title: str
    occurred_date: date | None


class SiteRecord(BaseModel):
    """A site's record as it stood."""

    name: str
    kind: SiteKind


class SiteHistoryEntry(BaseModel):
    """One fact in a site's history, computed from the site's tables.

    ``recorded_at`` is when the fact entered Vidit. ``fact_date`` is when it happened on the
    ground: the capture date of an image, or of the image a contour cites, the event date of a
    link entry, null for ``site_created`` and ``record_edited``. ``actor`` is null once that
    account is erased.

    Payload by kind: ``site_created`` sets ``record``, ``image_id`` and ``contour_id`` (the
    first ones); ``image_filed`` sets ``image_id``; ``contour_changed`` sets ``contour_id`` and
    ``image_id``; ``record_edited`` sets ``record`` and ``previous_record``; the three link
    kinds set ``event`` and ``link_effect``, and ``link_effect_changed`` also sets
    ``previous_link_effect``.
    """

    kind: SiteHistoryKind
    recorded_at: datetime
    fact_date: date | None
    actor: AuthorRef | None
    image_id: uuid.UUID | None = None
    contour_id: uuid.UUID | None = None
    record: SiteRecord | None = None
    previous_record: SiteRecord | None = None
    event: SiteHistoryEvent | None = None
    link_effect: LinkEffect | None = None
    previous_link_effect: LinkEffect | None = None
