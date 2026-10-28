import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self, cast

from pydantic import (
    AfterValidator,
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
from app.schemas.event import VERSION_NOTE_MAX_LENGTH, CoordsRead
from app.schemas.media import MediaRead
from app.schemas.source import (
    LIST_PARSE_CEILING,
    ImageryProviderRead,
    ImageryProviderRef,
    SourceLinkCreate,
    SourceRead,
    UtcDatetime,
)
from app.schemas.user import AuthorRef

SITE_SOURCE_NOTE_MAX_LENGTH = 500
# Sources one site write adds.
MAX_SOURCES_PER_WRITE = 10
# Vertices across every ring of one zone; a hand-drawn site needs far fewer.
MAX_ZONE_VERTICES = 1000
# A zone covers a site, not a region: the largest sites, training grounds, cover a few hundred
# km², so this cap holds them with margin and refuses a region drawn by mistake (docs/api.md).
# Mirrored by ``frontend/src/lib/siteZone.ts::MAX_ZONE_AREA_KM2``; change both.
MAX_ZONE_AREA_KM2 = 1_000
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


class SiteSourceCreate(BaseModel):
    """One dated satellite source filed on a site.

    The links are where a reader reopens the capture (``services/imagery``). The file is one of
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
    note: str | None = Field(None, max_length=SITE_SOURCE_NOTE_MAX_LENGTH)

    @field_validator("note")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None

    @model_validator(mode="after")
    def _one_file_and_a_past_capture(self) -> Self:
        if self.upload_id is not None and self.media_id is not None:
            raise ValueError("A source carries one file: send upload_id or media_id, not both")
        if self.captured_at > datetime.now(UTC):
            raise ValueError("captured_at may not be in the future")
        return self


class SiteEventLinkCreate(BaseModel):
    """One of your events linked to the site, with the effect it shows there."""

    model_config = ConfigDict(extra="forbid")

    event_id: uuid.UUID
    effect: LinkEffect


def _distinct_events(links: list[SiteEventLinkCreate]) -> list[SiteEventLinkCreate]:
    if len({link.event_id for link in links}) != len(links):
        raise ValueError("an event appears once in event_links")
    return links


SiteEventLinks = Annotated[
    list[SiteEventLinkCreate],
    Field(max_length=LIST_PARSE_CEILING),
    AfterValidator(_distinct_events),
]


class SiteCreate(BaseModel):
    """Body of ``POST /sites``: the record, the first source, the contour it shows, and your
    events linked to the site."""

    name: SiteName
    kind: SiteKind
    contour: ZonePolygon
    source: SiteSourceCreate
    event_links: SiteEventLinks = Field(default_factory=list)


class SiteContourChange(BaseModel):
    """The contour one source carries after the write: ``zone``, or none when ``zone`` is null.

    The source is a live source of the site (``source_id``) or one the same write adds
    (``added_source``, an index into ``added_sources``).
    """

    model_config = ConfigDict(extra="forbid")

    source_id: uuid.UUID | None = None
    added_source: int | None = Field(None, ge=0)
    zone: ZonePolygon | None

    @model_validator(mode="after")
    def _one_source(self) -> Self:
        if (self.source_id is None) == (self.added_source is None):
            raise ValueError("A contour change names source_id or added_source, not both")
        return self

    @property
    def target(self) -> uuid.UUID | int:
        """The source it applies to: a live source's id, or an index into ``added_sources``."""
        return self.source_id if self.source_id is not None else cast(int, self.added_source)


class SiteVersionCreate(BaseModel):
    """Body of ``POST /sites/{id}/versions``: the record, the sources to add and to remove, the
    contour changes, your events linked to the site (``null`` leaves the links as they are), and
    the optional note filed with the version the edit supersedes."""

    model_config = ConfigDict(extra="forbid")

    version_no: int = Field(ge=1)
    name: SiteName
    kind: SiteKind
    added_sources: list[SiteSourceCreate] = Field(
        default_factory=list, max_length=MAX_SOURCES_PER_WRITE
    )
    removed_source_ids: list[uuid.UUID] = Field(default_factory=list, max_length=LIST_PARSE_CEILING)
    contours: list[SiteContourChange] = Field(default_factory=list, max_length=LIST_PARSE_CEILING)
    event_links: SiteEventLinks | None = None
    note: str | None = Field(None, max_length=VERSION_NOTE_MAX_LENGTH)

    @field_validator("note")
    @classmethod
    def _blank_note_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if len(set(self.removed_source_ids)) != len(self.removed_source_ids):
            raise ValueError("a source appears once in removed_source_ids")
        targets = [
            change.source_id if change.source_id is not None else change.added_source
            for change in self.contours
        ]
        if len(set(targets)) != len(targets):
            raise ValueError("a source takes one contour change")
        for change in self.contours:
            if change.added_source is not None and change.added_source >= len(self.added_sources):
                raise ValueError("added_source names no source of added_sources")
        return self


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


class SiteSourceRead(SourceRead):
    """One source of a site, with its imagery provider, analyst and note."""

    provider: ImageryProviderRead | None
    author: AuthorRef | None
    note: str | None
    created_at: datetime


class SiteSourceFiledRead(SiteSourceRead):
    """``POST /sites/{id}/sources`` answer: the source, and the sources already filed on the site
    with the same provider and capture date."""

    duplicate_source_ids: list[uuid.UUID]


class SiteContourRead(BaseModel):
    """One contour the owner drew; ``captured_at`` is its source's, the date it holds from."""

    id: uuid.UUID
    zone: ZonePolygon
    source_id: uuid.UUID
    captured_at: datetime
    author: AuthorRef | None
    created_at: datetime


class SiteLastSourceRead(BaseModel):
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
    ``media`` is the event's card thumbnail (``services.thumbnails``).
    """

    id: uuid.UUID
    title: str
    occurred_date: date | None
    coords: CoordsRead
    owner: AuthorRef
    is_graphic: bool
    media: MediaRead | None
    effect: LinkEffect
    linked_at: datetime
    inside_zone: bool
    distance_m: float | None
    measured_contour_id: uuid.UUID


class SiteState(BaseModel):
    """What every site read derives from the contours, the sources and the links, at the read's
    date."""

    id: uuid.UUID
    name: str
    kind: SiteKind
    zone: ZonePolygon
    centroid: CoordsRead
    contour_id: uuid.UUID
    last_source: SiteLastSourceRead | None
    latest_link_effect: LatestLinkEffect | None


class SiteList(SiteState):
    """One site on the map, read at ``as_of``."""

    owner_id: uuid.UUID


class SiteRead(SiteState):
    """The full site: its current state, its sources and their contours, oldest capture first,
    and every visible linked event, oldest first. ``version_no`` is the live version.
    ``hidden_at`` is set only on a withheld site, which only an admin reads."""

    owner: AuthorRef
    version_no: int
    hidden_at: datetime | None
    sources: list[SiteSourceRead]
    contours: list[SiteContourRead]
    linked_events: list[SiteLinkedEventRead]
    created_at: datetime
    updated_at: datetime


class SiteCreatedRead(SiteRead):
    """``POST /sites`` answer: the new site and the visible sites its zone overlaps."""

    overlapping_sites: list[SiteOverlapRead]


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


class SiteSnapshotSource(BaseModel):
    id: uuid.UUID
    contour_id: uuid.UUID | None


class SiteSnapshot(BaseModel):
    """What ``site_versions.snapshot`` stores: the name, the kind, and each source of the version,
    oldest capture first, with the contour it carried."""

    name: str
    kind: SiteKind
    sources: list[SiteSnapshotSource]


class SiteVersionRead(BaseModel):
    """One superseded version of a site: its record, its sources and their contours, and the
    state they give now (the zone of the latest captured source with a contour, its centroid,
    and the last source).

    ``edited_by`` and ``created_at`` belong to the write that superseded this version, as on an
    event version. ``edited_by`` is null once that account is soft-deleted or erased.
    """

    id: uuid.UUID
    version_no: int
    edited_by: AuthorRef | None
    created_at: datetime
    # NULL when the write that superseded this version left none.
    note: str | None
    name: str
    kind: SiteKind
    zone: ZonePolygon
    centroid: CoordsRead
    contour_id: uuid.UUID
    last_source: SiteLastSourceRead | None
    sources: list[SiteSourceRead]
    contours: list[SiteContourRead]


class SiteVersionList(BaseModel):
    """A site's superseded versions, newest first. ``total`` is the whole history."""

    items: list[SiteVersionRead]
    total: int
