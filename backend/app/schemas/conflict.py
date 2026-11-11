import uuid

from pydantic import BaseModel

from app.models.conflict import ConflictTier


class ConflictRead(BaseModel):
    """One row of the conflicts referential. ``last_seen_at`` and ``origin`` are sync internals
    and stay off it."""

    id: uuid.UUID
    name: str
    wikidata_id: str | None
    start_year: int | None
    end_year: int | None
    tier: ConflictTier | None
    is_ongoing: bool

    model_config = {"from_attributes": True}
