import uuid
from datetime import date, datetime
from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.event import TITLE_MAX_LENGTH
from app.models.media import MediaKind, MediaRole
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef
from app.services.event_filters import EventFilters

# Measured on the plain-text projection (``services/sanitize.html_text``), not the markup.
# Mirrored by ``frontend/src/lib/collections.ts::COLLECTION_DESCRIPTION_MAX_LEN``.
DESCRIPTION_MAX_LENGTH = 500

# Events one create or one bulk add may shelve: a ceiling on the body so a
# runaway request can't open one transaction over the whole catalogue.
# Mirrored by ``frontend/src/lib/collections.ts::BULK_ADD_MAX_EVENTS``; change both.
MAX_CREATE_EVENTS = 500


class CollectionWrite(BaseModel):
    """The fields a collection carries, as a create or an update sends them. What
    ``description`` may carry is judged in ``services/collections``, beside the write."""

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    description: str

    @field_validator("title")
    @classmethod
    def _required_text(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class CollectionCreate(CollectionWrite):
    """Body of ``POST /collections``: title, description and the opening events."""

    event_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_CREATE_EVENTS)

    @field_validator("event_ids")
    @classmethod
    def _unique(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        return list(dict.fromkeys(v))


class CollectionUpdate(CollectionWrite):
    """Body of ``PATCH /collections/{id}``: title and description together,
    under the create's caps, so one request states what the collection is."""


class CollectionCoverTile(BaseModel):
    """One tile of a collection's mosaic. ``role`` says whether the picture has display
    derivatives: a ``proof`` image has no ``_hero`` or ``_thumb`` sibling."""

    url: str
    kind: MediaKind
    role: MediaRole


class CollectionRead(BaseModel):
    """One collection as every read surface renders it. The counts, dates, cover and tags are
    computed at read time over the events the collection may show."""

    id: uuid.UUID
    owner: AuthorRef
    title: str
    description: str
    description_text: str
    cover: list[CollectionCoverTile]
    tags: list[TagRead]
    event_count: int
    first_date: date | None
    last_date: date | None
    created_at: datetime
    # Set only on a withheld collection, which only an admin reads.
    hidden_at: datetime | None


class CollectionList(BaseModel):
    """One page of an analyst's collections, newest first."""

    items: list[CollectionRead]
    total: int
    page: int
    per_page: int


class CollectionMembershipRead(BaseModel):
    """One of the caller's collections, and whether one event is already in it."""

    id: uuid.UUID
    title: str
    cover: list[CollectionCoverTile]
    event_count: int
    in_collection: bool


class CollectionMembershipList(BaseModel):
    """Every collection the caller owns, as the popover reads them."""

    items: list[CollectionMembershipRead]


class SearchMatch(BaseModel):
    """What one search names: ``q`` and the event filters of ``GET /search``, as a JSON body,
    under the query parameters' names."""

    q: str = ""
    filters: EventFilters = Field(default_factory=EventFilters)


class CollectableCount(BaseModel):
    """How many of the caller's events a :class:`SearchMatch` lists in the search
    Geolocations group that a collection can hold."""

    total: int


class CollectionBulkAdd(BaseModel):
    """Body of ``POST /collections/{id}/events``: exactly one of ``event_ids`` or ``match``.

    The service, not the schema, caps the events and the exclusions, so every mode answers
    with the same ``too_many_events`` code.
    """

    event_ids: list[uuid.UUID] | None = None
    match: SearchMatch | None = None
    exclude_event_ids: list[uuid.UUID] = Field(default_factory=list)

    @field_validator("event_ids", "exclude_event_ids")
    @classmethod
    def _unique(cls, v: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        return None if v is None else list(dict.fromkeys(v))

    @model_validator(mode="after")
    def _exactly_one(self) -> Self:
        if (self.event_ids is None) == (self.match is None):
            raise ValueError("send exactly one of event_ids or match")
        if self.exclude_event_ids and self.match is None:
            raise ValueError("exclude_event_ids narrows a match only")
        return self


class CollectionBulkAddSkipped(BaseModel):
    """Events a bulk add left out, by reason. Neither is an error."""

    already_in_collection: int
    not_collectable: int


class CollectionBulkAddResult(BaseModel):
    """What one bulk add wrote: ``added`` new memberships and the events it skipped."""

    added: int
    skipped: CollectionBulkAddSkipped
