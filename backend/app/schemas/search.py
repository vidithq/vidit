"""Pydantic shapes for ``GET /search``.

Hits carry a ``*_highlight`` field with sentinel-delimited match
fragments (see ``services.search.HIGHLIGHT_START`` / ``HIGHLIGHT_STOP``)
that the frontend turns into ``<mark>`` tags. No raw HTML crosses the
wire — XSS-safe by construction.

Field sets mirror the existing list shapes (``GeolocationList``,
``BountyList``) plus the highlight strings, so the search-result card
can reuse the same components.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class SearchGeolocationHit(BaseModel):
    id: uuid.UUID
    title: str
    # ts_headline output with sentinel delimiters — the title text with
    # ``[[HL]]…[[/HL]]`` around the matched fragments. Always present
    # because the title field is always indexed.
    title_highlight: str
    lat: float
    lng: float
    event_date: date
    is_demo: bool
    author: AuthorRef
    tags: list[TagRead]

    model_config = {"from_attributes": True}


class SearchBountyHit(BaseModel):
    id: uuid.UUID
    title: str
    title_highlight: str
    source_url: str
    status: str
    created_at: datetime
    is_demo: bool
    author: AuthorRef
    media: list[MediaRead]
    tags: list[TagRead]
    # Denormalised here so the card can render the "N working" badge
    # without a per-result follow-up fetch. Mirrors ``BountyList``.
    claimer_count: int

    model_config = {"from_attributes": True}


class SearchUserHit(BaseModel):
    id: uuid.UUID
    username: str
    # Always present — username sits in the index unconditionally.
    username_highlight: str
    bio: str | None
    # Only set when the bio actually contributed a highlighted
    # fragment; ``None`` for username-only matches so the UI can hide
    # the snippet block instead of rendering an un-highlighted bio.
    bio_highlight: str | None
    is_trusted: bool
    trust_reason: str | None
    avatar_url: str | None

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    """Grouped result set. Empty arrays for groups the caller didn't
    request via ``type=`` — keeps the JSON shape stable so the
    frontend doesn't need conditional access."""

    geolocations: list[SearchGeolocationHit]
    bounties: list[SearchBountyHit]
    users: list[SearchUserHit]

    # Tiny denormalised totals so the UI can render group counts
    # ("12 geolocations, 4 bounties, 1 analyst") without re-summing
    # the lists.
    total: dict[str, int]

    # Echoes the inputs so the frontend can sanity-check the response
    # belongs to the current query state (the browser may have
    # multiple requests in flight while the user types).
    query: str
    type: str

    model_config = {"from_attributes": True}
