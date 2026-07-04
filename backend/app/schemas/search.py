"""Pydantic shapes for ``GET /search``.

Hits carry ``*_highlight`` fields with sentinel-delimited match fragments (see
``services.search.HIGHLIGHT_START`` / ``HIGHLIGHT_STOP``) that the frontend
turns into ``<mark>`` tags. No raw HTML crosses the wire — XSS-safe by
construction. Field sets mirror the ``EventList`` card shape plus the
highlights, so the result card reuses the same components.

The geolocation + request groups are two views over the one ``events`` table
(the located rows vs the ``requested`` ones), so both run through a single
FTS query path in ``services.search``; the two hit shapes differ only in the
fields each view surfaces (coordinates for the located view, claimer counts for
the requested one).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.models.event import EventStatus
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef

# The ``type=`` query values, echoed back on the response. Mirrors
# ``services.search.ALLOWED_TYPES`` (kept a plain set there for the runtime
# membership check); this Literal is the typed contract the OpenAPI spec ships.
SearchType = Literal["all", "geolocation", "request", "user"]


class SearchTotals(BaseModel):
    """Per-group pre-LIMIT match counts, so the UI renders "12 geolocations, 4
    requests, 1 analyst" without re-summing the (LIMIT-capped) hit lists."""

    geolocations: int
    requests: int
    users: int


class SearchEventHit(BaseModel):
    id: uuid.UUID
    title: str
    # ts_headline output: title text with ``[[HL]]…[[/HL]]`` around matched
    # fragments. Always present — the title field is always indexed.
    title_highlight: str
    lat: float
    lng: float
    # Nullable (a machine detection often has no known date) but always
    # serialised: ``services.search.search_geolocations`` sets the key on every hit.
    event_date: date | None
    is_demo: bool
    # ``detected`` rows surface in search marked, like everywhere else.
    status: EventStatus
    owner: AuthorRef
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class SearchRequestHit(BaseModel):
    id: uuid.UUID
    title: str
    title_highlight: str
    source_url: str
    # A requested-view hit is ``requested`` (or ``closed`` once withdrawn).
    status: EventStatus
    created_at: datetime
    is_demo: bool
    owner: AuthorRef
    media: list[MediaRead]
    tags: list[TagRead]
    # Denormalised so the card renders the "N working" badge without a
    # per-result fetch. Mirrors ``EventList.investigator_count``; the "claimer"
    # name is reader vocabulary kept stable on this wire shape.
    claimer_count: int

    model_config = {"from_attributes": True}


class SearchUserHit(BaseModel):
    id: uuid.UUID
    username: str
    # Always present — username sits in the index unconditionally.
    username_highlight: str
    bio: str | None
    # Set only when the bio contributed a highlighted fragment; ``None`` for
    # username-only matches so the UI hides the snippet block instead of
    # rendering an un-highlighted bio.
    bio_highlight: str | None
    is_trusted: bool
    trust_reason: str | None
    avatar_url: str | None

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    """Grouped result set. Empty arrays for groups the caller didn't request via
    ``type=`` — keeps the JSON shape stable so the frontend skips conditional access."""

    geolocations: list[SearchEventHit]
    requests: list[SearchRequestHit]
    users: list[SearchUserHit]

    # Denormalised totals so the UI renders group counts ("12 geolocations, 4
    # requests, 1 analyst") without re-summing the lists.
    total: SearchTotals

    # Echoes the inputs so the frontend can confirm the response matches the
    # current query state (the browser may have several requests in flight as
    # the user types).
    query: str
    type: SearchType

    model_config = {"from_attributes": True}
