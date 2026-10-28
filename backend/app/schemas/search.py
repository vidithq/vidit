"""Pydantic shapes for ``GET /search``.

One ranked list of hits of five types, told apart by ``type``. Hits carry
``*_highlight`` fields with sentinel-delimited match fragments
(``services.search.HIGHLIGHT_START`` / ``HIGHLIGHT_STOP``) that the frontend
turns into ``<mark>`` tags, so no raw HTML crosses the wire.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.event import EventStatus
from app.models.site import SiteKind
from app.schemas.collection import CollectionRead
from app.schemas.media import MediaRead
from app.schemas.site import SiteLastSourceRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class SearchEventHit(BaseModel):
    """A geolocated or detected event, or an open request."""

    type: Literal["event"] = "event"
    id: uuid.UUID
    title: str
    title_highlight: str
    status: EventStatus
    occurred_date: date | None
    created_at: datetime
    # The subject coordinate of a geolocated or detected row; null on a request, whose guess is
    # no located point.
    lat: float | None
    lng: float | None
    # See ``EventRead.is_graphic``; travels with the hit to avoid a detail fetch.
    is_graphic: bool
    owner: AuthorRef
    # See ``EventRead.geolocators``.
    geolocators: list[AuthorRef]
    # The card thumbnail (at most one row, ``services.thumbnails``).
    media: list[MediaRead]
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class SearchSiteHit(BaseModel):
    """A visible site with its latest source and its picture (``SiteItem.media``)."""

    type: Literal["site"] = "site"
    id: uuid.UUID
    name: str
    name_highlight: str
    kind: SiteKind
    owner: AuthorRef
    last_source: SiteLastSourceRead | None
    # At most one row.
    media: list[MediaRead]

    model_config = {"from_attributes": True}


class SearchCollectionHit(CollectionRead):
    """The ``CollectionRead`` every surface renders. No ``*_highlight``."""

    type: Literal["collection"] = "collection"


class SearchUserHit(BaseModel):
    type: Literal["user"] = "user"
    id: uuid.UUID
    username: str
    username_highlight: str
    bio: str | None
    # Set only when the bio contributed a fragment.
    bio_highlight: str | None
    avatar_url: str | None

    model_config = {"from_attributes": True}


class SearchOrganizationHit(BaseModel):
    """Public fields only, the organization page's header: no approval request
    audience, no creator."""

    type: Literal["organization"] = "organization"
    id: uuid.UUID
    slug: str
    name: str
    name_highlight: str
    bio: str | None
    # Same rule as ``SearchUserHit.bio_highlight``.
    bio_highlight: str | None
    avatar_url: str | None
    member_count: int


SearchHit = Annotated[
    SearchEventHit | SearchSiteHit | SearchCollectionHit | SearchUserHit | SearchOrganizationHit,
    Field(discriminator="type"),
]


class SearchResponse(BaseModel):
    """One page of hits in rank order."""

    hits: list[SearchHit]
    # The whole match count, before the page cut.
    total: int
    # The next page, passed back as ``?cursor=`` with the same query, types and filters; ``None``
    # on the last page.
    cursor: str | None
    # A respelling of ``query`` that finds results, set only when nothing matched
    # (``services.search.spelling_suggestion``).
    suggestion: str | None = None
    # Echoes ``q`` so the frontend can match a response to the current query.
    query: str


class AuthorSuggestions(BaseModel):
    """``GET /search/authors``: usernames for the author-filter typeahead
    (prefix matches first, then alphabetical). The filter is an exact match,
    so this is how a partial name becomes a handle."""

    authors: list[str]
