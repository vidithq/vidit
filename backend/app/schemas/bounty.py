import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

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
    description: dict[str, Any] | None
    status: str
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    # Mirrors ``GeolocationRead.is_demo`` — TRUE iff seeded by the admin
    # "Demo bounties" panel. The frontend uses this to swap the
    # synthetic source_url for an inert label so testers don't click
    # out to a 404; the visible signal that a bounty is demo is the
    # always-attached `demo` tag, not a dedicated badge.
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
    status: str
    created_at: datetime
    is_demo: bool
    author: AuthorRef
    media: list[MediaRead]
    tags: list[TagRead]
    # Denormalised so the index card doesn't N+1 — the list endpoint
    # supplies the full count plus a small avatar-sized sample
    # (newest claimers first, capped). Detail page fetches the full
    # claimers list via ``GET /bounties/{id}``.
    claimer_count: int
    claimer_sample: list[AuthorRef]

    model_config = {"from_attributes": True}
