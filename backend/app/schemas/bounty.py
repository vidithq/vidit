import uuid
from datetime import date, datetime, time
from typing import Any

from pydantic import BaseModel

from app.models.bounty import BountyStatus
from app.schemas.media import MediaRead
from app.schemas.tag import TagRead
from app.schemas.user import AuthorRef


class _FulfilledByNested(BaseModel):
    id: uuid.UUID
    title: str

    model_config = {"from_attributes": True}


class BountyRead(BaseModel):
    id: uuid.UUID
    title: str
    source_url: str
    proof: dict[str, Any] | None
    # When the event happened (date + optional hour) — nullable, a bounty is an
    # unfinished geolocation. ``source_posted_at`` is the source's post instant
    # (UTC), required: the bounty's ``source_url`` is, so its post time is too.
    event_date: date | None = None
    event_time: time | None = None
    source_posted_at: datetime
    status: BountyStatus
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    # Mirrors ``GeolocationRead.is_demo`` — TRUE iff seeded by the admin "Demo
    # bounties" panel. The frontend swaps the synthetic source_url for an inert
    # label so testers don't click out to a 404; the visible demo signal is the
    # always-attached `demo` tag, not a badge.
    is_demo: bool
    author: AuthorRef
    media: list[MediaRead]
    tags: list[TagRead]
    claimers: list[AuthorRef]
    fulfilled_by: _FulfilledByNested | None

    model_config = {"from_attributes": True}


class BountyList(BaseModel):
    id: uuid.UUID
    title: str
    source_url: str
    status: BountyStatus
    created_at: datetime
    is_demo: bool
    author: AuthorRef
    media: list[MediaRead]
    tags: list[TagRead]
    # Denormalised so the index card doesn't N+1: full count plus a small,
    # capped sample (newest claimers first). The detail page fetches the full
    # list via ``GET /bounties/{id}``.
    claimer_count: int
    claimer_sample: list[AuthorRef]

    model_config = {"from_attributes": True}
