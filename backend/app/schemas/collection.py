import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.event import TITLE_MAX_LENGTH
from app.schemas.user import AuthorRef


class CollectionCreate(BaseModel):
    """Body of ``POST /collections``. The title is the only field a collection
    carries: items order themselves by when their events happened, so there is
    no description and no manual order to submit."""

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)


class CollectionUpdate(BaseModel):
    """Body of ``PATCH /collections/{id}``. The title is the only mutable
    field, under the same cap the create takes."""

    title: str = Field(min_length=1, max_length=TITLE_MAX_LENGTH)


class CollectionRead(BaseModel):
    """One collection as every read surface renders it.

    ``event_count``, ``first_date`` and ``last_date`` are computed at read
    time over the events the collection may show
    (``services/event_filters.collectable_events``), never stored: a row that
    closes, is taken down or is soft-deleted leaves the count and the range
    without a write to the membership table. ``first_date`` and ``last_date``
    are the smallest and largest ``event_date`` among those events, so both
    are null for a collection holding nothing and for one whose items all
    lack a date.

    ``cover_url`` is what the card and the page band show. It resolves the
    owner's uploaded cover when they set one. With none set it falls back to
    the media of the first item in chronological order that is not flagged
    graphic, picked by the card-thumbnail rule
    (``services/thumbnails.pick_thumbnail``): the fallback is presentation
    only, over imagery the item's own page already shows. It is null when no
    item qualifies.

    ``cover_is_uploaded`` says which of the two ``cover_url`` resolved, true
    for the owner's own upload and false for the fallback and for no cover at
    all. Without it the two are one value and a client cannot tell a picture
    the owner chose from one the server picked, which is what the owner's
    remove-the-cover control needs to know: offering it against a fallback
    names an upload that does not exist.
    """

    id: uuid.UUID
    owner: AuthorRef
    title: str
    cover_url: str | None
    cover_is_uploaded: bool
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
    the collection already holds, so it carries no cover and no date range.

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
