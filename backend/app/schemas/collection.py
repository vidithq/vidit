import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.event import TITLE_MAX_LENGTH
from app.models.media import MediaType
from app.schemas.user import AuthorRef

# How long a collection's description may be. The profile bio's figure for the
# same class of text, a short plain-text blurb, kept as its own constant
# because the two are separate concepts: one says who an analyst is, the other
# says what one collection holds.
DESCRIPTION_MAX_LENGTH = 500


class CollectionWrite(BaseModel):
    """The fields a collection carries, as a create or an update sends them.

    Both write bodies take the same pair, so opening a collection and editing
    one cannot drift apart on a cap or on what counts as blank. The
    description is required: a collection says what it holds, in the same
    class of plain text as the profile bio.
    """

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)
    description: str = Field(min_length=1, max_length=DESCRIPTION_MAX_LENGTH)

    @field_validator("description")
    @classmethod
    def _description(cls, v: str) -> str:
        """Strip surrounding whitespace, and refuse what is left empty.

        The bio's normalisation (``schemas/user._normalise_optional``) without
        its empty-to-None branch, which belongs to an optional field: a
        description of spaces is a missing description, and the field is
        required, so it is a 422 rather than a stored blank.
        """
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("description must not be empty")
        return cleaned


class CollectionCreate(CollectionWrite):
    """Body of ``POST /collections``: the title and the description. Items
    order themselves by when their events happened, so there is no manual
    order to submit."""


class CollectionUpdate(CollectionWrite):
    """Body of ``PATCH /collections/{id}``: the title and the description
    together, under the caps the create takes. Both are sent on every edit,
    so one request states what the collection is rather than leaving the two
    fields to be saved apart."""


class CollectionCoverTile(BaseModel):
    """One tile of the mosaic a collection wears, and what kind of file it is.

    ``url`` points at the media of one item the collection holds. ``media_type``
    is the media-kind domain ``models/media.MediaType`` defines, so a client
    picks the element that can render the file: most source media in the corpus
    are clips, and an ``<img>`` pointed at one paints an empty band.
    """

    url: str
    media_type: MediaType


class CollectionRead(BaseModel):
    """One collection as every read surface renders it.

    ``title`` and ``description`` are the two free-text fields the owner
    writes, both required: the name of the collection and one short paragraph
    saying what it holds.

    ``event_count``, ``first_date`` and ``last_date`` are computed at read
    time over the events the collection may show
    (``services/event_filters.collectable_events``), never stored: a row that
    closes, is taken down or is soft-deleted leaves the count and the range
    without a write to the membership table. ``first_date`` and ``last_date``
    are the smallest and largest ``event_date`` among those events, so both
    are null for a collection holding nothing and for one whose items all
    lack a date.

    ``cover`` is the mosaic the profile card wears: zero to four tiles, each
    the media of one item the collection holds, computed at read time and
    never stored (``services/collections.cover_tiles_for`` states the rule).
    The list is empty when nothing on the collection carries media a card may
    show, and the collection's own page shows no cover at all.

    Each tile's url and kind travel together rather than as a bare url,
    because most source media in the corpus are clips: a tile taken off a
    video item is an ``.mp4``, and a client handed the url alone renders it in
    an ``<img>`` and shows an empty band.
    """

    id: uuid.UUID
    owner: AuthorRef
    title: str
    description: str
    cover: list[CollectionCoverTile]
    event_count: int
    first_date: date | None
    last_date: date | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CollectionList(BaseModel):
    """One page of an analyst's collections, newest first.

    Offset-paged rather than cursor-paged, like the profile feed beside it
    (``GET /users/{username}/events``): the profile renders a pager over a
    small set, and ``total`` counts the collections the caller may see, so the
    pager never counts a row the list will not serve.
    """

    items: list[CollectionRead]
    total: int
    page: int
    per_page: int


class CollectionMembershipRead(BaseModel):
    """One of the caller's collections, and whether one event is already in it.

    The add-to-collection popover's row. Thinner than :class:`CollectionRead`:
    the popover names a collection, shows a checked state and says how much
    the collection already holds, so it carries no description, no mosaic and
    no date range.

    ``event_count`` is computed over the same predicate
    (``services/event_filters.collectable_events``) the collection reads use,
    so the number under a title in the popover is the number the collection's
    own page prints.
    """

    id: uuid.UUID
    title: str
    event_count: int
    in_collection: bool


class CollectionMembershipList(BaseModel):
    """Every collection the caller owns, as the popover reads them."""

    items: list[CollectionMembershipRead]
