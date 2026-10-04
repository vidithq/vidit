import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.models.event import TITLE_MAX_LENGTH
from app.models.media import MediaRole, MediaType
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef

# Cap on a collection description, measured on its plain-text projection
# (``services/sanitize.tiptap_doc_text``), not the markup. Its own constant,
# separate from the bio's. Mirrored by
# ``frontend/src/lib/collections.ts::COLLECTION_DESCRIPTION_MAX_LEN``.
# ``services/collections`` measures documents against it.
DESCRIPTION_MAX_LENGTH = 500

# Events one create may shelve: a ceiling on the body so a runaway request
# can't open one transaction over the whole catalogue.
MAX_CREATE_EVENTS = 500


class CollectionWrite(BaseModel):
    """The fields a collection carries, as a create or an update sends them.

    One pair for both bodies so caps and blank rules can't drift. Both are
    required. ``description`` is a raw JSON Tiptap document; what it may carry
    and what counts as blank or over-long live in ``services/collections``,
    beside the write (the layering the event proof takes).
    """

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    description: dict[str, Any]

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

    ``url`` is the media of one held item. ``media_type``
    (``models/media.MediaType``) lets a client pick the element that renders
    it (most source media are clips, and an ``<img>`` on one paints an empty
    band). ``role`` (``models/media.MediaRole``) says whether the picture has
    display derivatives: only a ``source`` image does
    (``services/storage.upload_file``); a ``proof`` image has no ``_hero`` /
    ``_thumb`` sibling.
    """

    url: str
    media_type: MediaType
    role: MediaRole


class CollectionRead(BaseModel):
    """One collection as every read surface renders it.

    ``title`` and ``description`` (a Tiptap document) are the owner's two
    required fields. ``description_text`` is its plain-text projection
    (``services/sanitize.tiptap_doc_text``) for surfaces without rich text
    (card clamp, share card, snippet).

    ``event_count``, ``first_date`` and ``last_date`` are computed at read time
    over the events the collection may show
    (``services/event_filters.collectable_events``), so a closed, taken-down or
    soft-deleted row leaves them without a write. The dates are the min and max
    ``event_date`` and are null for an empty or undated collection.

    ``cover`` is the card's mosaic: zero to four tiles, computed at read time
    (``services/collections.cover_tiles_for``), empty when no item has showable
    media. Each tile carries url, kind and role together (see
    :class:`CollectionCoverTile`).

    ``tags`` is the union of the tags of the events the collection may show,
    ordered by category then name (``services/collections.tags_for``), derived
    and never stored; empty when nothing is tagged.
    """

    id: uuid.UUID
    owner: AuthorRef
    title: str
    description: dict[str, Any]
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
    (no description, mosaic or date range). ``event_count`` uses the same
    predicate as the collection reads
    (``services/event_filters.collectable_events``).
    """

    id: uuid.UUID
    title: str
    event_count: int
    in_collection: bool


class CollectionMembershipList(BaseModel):
    """Every collection the caller owns, as the popover reads them."""

    items: list[CollectionMembershipRead]
