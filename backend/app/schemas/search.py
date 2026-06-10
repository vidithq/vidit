"""Pydantic shapes for ``GET /search``.

Hits carry ``*_highlight`` fields with sentinel-delimited match fragments (see
``services.search.HIGHLIGHT_START`` / ``HIGHLIGHT_STOP``) that the frontend
turns into ``<mark>`` tags. No raw HTML crosses the wire — XSS-safe by
construction. Field sets mirror the list shapes (``GeolocationList``,
``BountyList``) plus the highlights, so the result card reuses the same components.
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
    # ts_headline output: title text with ``[[HL]]…[[/HL]]`` around matched
    # fragments. Always present — the title field is always indexed.
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
    # Denormalised so the card renders the "N working" badge without a
    # per-result fetch. Mirrors ``BountyList``.
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

    geolocations: list[SearchGeolocationHit]
    bounties: list[SearchBountyHit]
    users: list[SearchUserHit]

    # Denormalised totals so the UI renders group counts ("12 geolocations, 4
    # bounties, 1 analyst") without re-summing the lists.
    total: dict[str, int]

    # Echoes the inputs so the frontend can confirm the response matches the
    # current query state (the browser may have several requests in flight as
    # the user types).
    query: str
    type: str

    model_config = {"from_attributes": True}
