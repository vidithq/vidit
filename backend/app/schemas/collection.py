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
    """

    id: uuid.UUID
    owner: AuthorRef
    title: str
    cover_url: str | None
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

    The add-to-collection popover's row. Deliberately thinner than
    :class:`CollectionRead`: the popover names a collection and shows a
    checked state, so it carries no cover and no date range to compute.
    """

    id: uuid.UUID
    title: str
    in_collection: bool


class CollectionMembershipList(BaseModel):
    """Every collection the caller owns, as the popover reads them."""

    items: list[CollectionMembershipRead]
