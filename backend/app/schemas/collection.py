import uuid
from datetime import date, datetime
from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.event import TITLE_MAX_LENGTH
from app.models.media import MediaKind, MediaRole
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef
from app.services.event_filters import EventFilters

# Cap on a collection description, measured on its plain-text projection
# (``services/sanitize.html_text``), not the markup. Its own constant,
# separate from the bio's. Mirrored by
# ``frontend/src/lib/collections.ts::COLLECTION_DESCRIPTION_MAX_LEN``.
# ``services/collections`` measures descriptions against it.
DESCRIPTION_MAX_LENGTH = 500

# Events one create or one bulk add may shelve: a ceiling on the body so a
# runaway request can't open one transaction over the whole catalogue.
# Mirrored by ``frontend/src/lib/collections.ts::BULK_ADD_MAX_EVENTS``; change both.
MAX_CREATE_EVENTS = 500


class CollectionWrite(BaseModel):
    """The fields a collection carries, as a create or an update sends them.

    One pair for both bodies so caps and blank rules can't drift. Both are
    required. ``description`` is raw HTML; what it may carry
    and what counts as blank or over-long live in ``services/collections``,
    beside the write (the layering the event proof takes).
    """

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    description: str

    @field_validator("title")
    @classmethod
    def _required_text(cls, v: str) -> str:
        """Strip whitespace and refuse an empty result (a required field, so a
        422 rather than a stored blank)."""
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class CollectionCreate(CollectionWrite):
    """Body of ``POST /collections``: title, description and the opening events.

    ``event_ids`` defaults empty. With ids, the create and shelving are one
    transaction through the checks of ``PUT /collections/{id}/events/{event_id}``,
    so an ineligible or foreign id fails the whole create. Ids are
    de-duplicated in arrival order and capped at :data:`MAX_CREATE_EVENTS`;
    items order by event date, so arrival order carries nothing else.
    """

    event_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_CREATE_EVENTS)

    @field_validator("event_ids")
    @classmethod
    def _unique(cls, v: list[uuid.UUID]) -> list[uuid.UUID]:
        """Collapse repeats, keeping the first occurrence of each id."""
        return list(dict.fromkeys(v))


class CollectionUpdate(CollectionWrite):
    """Body of ``PATCH /collections/{id}``: title and description together,
    under the create's caps, so one request states what the collection is."""


class CollectionCoverTile(BaseModel):
    """One tile of a collection's mosaic and what kind of file it is.

    ``url`` is the media of one held item. ``kind``
    (``models/media.MediaKind``) lets a client pick the element that renders
    it (most source media are clips, and an ``<img>`` on one paints an empty
    band). ``role`` (``models/media.MediaRole``) says whether the picture has
    display derivatives: only a source's image does
    (``services/storage.upload_source_file``); a ``proof`` image has no ``_hero`` /
    ``_thumb`` sibling.
    """

    url: str
    kind: MediaKind
    role: MediaRole


class CollectionRead(BaseModel):
    """One collection as every read surface renders it.

    ``title`` and ``description`` (sanitised HTML) are the owner's two
    required fields. ``description_text`` is its plain-text projection
    (``services/sanitize.html_text``) for surfaces without rich text
    (card clamp, share card, snippet).

    ``event_count``, ``first_date`` and ``last_date`` are computed at read time
    over the events the collection may show
    (``services/event_filters.collectable_events``), so a closed, taken-down or
    soft-deleted row leaves them without a write. The dates are the min and max
    ``occurred_date`` and are null for an empty or undated collection.

    ``cover`` is the card's mosaic: zero to four tiles, computed at read time
    (``services/collections.cover_tiles_for``), empty when no item has showable
    media. Each tile carries url, kind and role together (see
    :class:`CollectionCoverTile`).

    ``tags`` is the union of the tags of the events the collection may show
    and their sources, ordered by name (``services/collections.tags_for``), derived
    and never stored; empty when nothing is tagged.
    """

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


class CollectionList(BaseModel):
    """One page of an analyst's collections, newest first.

    Offset-paged like ``GET /users/{username}/events``; ``total`` counts the
    collections the caller may see.
    """

    items: list[CollectionRead]
    total: int
    page: int
    per_page: int


class CollectionMembershipRead(BaseModel):
    """One of the caller's collections, and whether one event is already in it.

    The add-to-collection popover's row, thinner than :class:`CollectionRead`
    (no description or date range). ``event_count`` and ``cover`` use the same
    predicate as the collection reads
    (``services/event_filters.collectable_events``).
    """

    id: uuid.UUID
    title: str
    cover: list[CollectionCoverTile]
    event_count: int
    in_collection: bool


class CollectionMembershipList(BaseModel):
    """Every collection the caller owns, as the popover reads them."""

    items: list[CollectionMembershipRead]


class SearchMatch(BaseModel):
    """What one search names: ``q`` and the event filters of ``GET /search``, as a JSON body.

    ``filters`` takes the query parameters' names and values
    (``services/event_filters.EventFilters``), checked by ``EventFilters.validate``.
    The ``match`` of :class:`CollectionBulkAdd` and the body of
    ``POST /collections/collectable-count``.
    """

    q: str = ""
    filters: EventFilters = Field(default_factory=EventFilters)


class CollectableCount(BaseModel):
    """How many of the caller's events a :class:`SearchMatch` lists in the search
    Geolocations group that a collection can hold."""

    total: int


class CollectionBulkAdd(BaseModel):
    """Body of ``POST /collections/{id}/events``: exactly one of ``event_ids`` or ``match``.

    ``event_ids`` are de-duplicated in arrival order. ``match`` names the
    caller's collectable events a search lists in its Geolocations group, less
    ``exclude_event_ids`` (match only, de-duplicated). Past
    :data:`MAX_CREATE_EVENTS` events, or exclusions, is a 422 ``too_many_events``,
    raised by the service so every mode answers with the same code.
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
