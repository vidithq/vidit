"""Pydantic shapes for ``GET /search``.

Four groups: the two event views, collections and analysts. Hits carry
``*_highlight`` fields with sentinel-delimited match fragments
(``services.search.HIGHLIGHT_START`` / ``HIGHLIGHT_STOP``) that the frontend
turns into ``<mark>`` tags, so no raw HTML crosses the wire. Field sets mirror
the ``EventList`` card plus highlights. The geolocation and request groups are
two views over ``events`` sharing one FTS path in ``services.search``.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.models.event import EventStatus
from app.schemas.collection import CollectionRead
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef

# The ``type=`` values, echoed on the response. Mirrors
# ``services.search.ALLOWED_TYPES`` (a plain set there for the runtime check).
SearchType = Literal["all", "event", "geolocation", "request", "collection", "user"]


class SearchTotals(BaseModel):
    """Per-group pre-LIMIT match counts, so the UI needn't re-sum the capped hit lists."""

    geolocations: int
    requests: int
    collections: int
    users: int


class SearchEventHit(BaseModel):
    id: uuid.UUID
    title: str
    # ts_headline output with ``[[HL]]…[[/HL]]`` around matches; always present.
    title_highlight: str
    lat: float
    lng: float
    # Nullable but always serialised (``services.search.search_geolocations``).
    event_date: date | None
    # See ``EventRead.is_graphic``; travels with the hit to avoid a detail fetch.
    is_graphic: bool
    # ``detected`` rows surface marked, as everywhere else.
    status: EventStatus
    owner: AuthorRef
    # Picked card thumbnail (at most one row, ``services.thumbnails``). A list
    # for wire stability; the card renders ``media[0]``.
    media: list[MediaRead]
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class SearchRequestHit(BaseModel):
    id: uuid.UUID
    title: str
    title_highlight: str
    # Required-nullable; a ``requested`` hit always has one today
    # (``ck_events_source_url_status``).
    source_url: str | None
    # ``requested``, or ``closed`` once withdrawn.
    status: EventStatus
    created_at: datetime
    # Same cover gate as ``SearchEventHit.is_graphic``.
    is_graphic: bool
    owner: AuthorRef
    # Same shape as ``SearchEventHit.media``.
    media: list[MediaRead]
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class SearchUserHit(BaseModel):
    id: uuid.UUID
    username: str
    # Always present: username is always indexed.
    username_highlight: str
    bio: str | None
    # Set only when the bio contributed a fragment; ``None`` lets the UI hide
    # the snippet block.
    bio_highlight: str | None
    avatar_url: str | None

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    """Grouped result set. Groups not requested via ``type=`` are empty arrays,
    keeping the JSON shape stable."""

    geolocations: list[SearchEventHit]
    requests: list[SearchRequestHit]
    # A hit is the ``CollectionRead`` every surface renders, so a result is the
    # profile's card. No ``*_highlight``: the card shows a two-line clamp, which
    # a mark would often cut.
    collections: list[CollectionRead]
    users: list[SearchUserHit]

    # Group totals, so the UI needn't re-sum the lists.
    total: SearchTotals

    # Echoes the inputs so the frontend can match a response to the current
    # query among in-flight requests.
    query: str
    type: SearchType

    model_config = {"from_attributes": True}


class AuthorSuggestions(BaseModel):
    """``GET /search/authors``: usernames for the author-filter typeahead
    (prefix matches first, then alphabetical). The filter is an exact match,
    so this is how a partial name becomes a handle."""

    authors: list[str]
