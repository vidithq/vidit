import uuid

from pydantic import BaseModel

from app.models.conflict import ConflictTier


class ConflictRead(BaseModel):
    """One row of the conflicts referential on the wire.

    ``last_seen_at`` and ``source`` are sync internals and stay off it.
    ``ongoing`` drives the picker default; ``start_year`` / ``end_year``
    disambiguate same-named entries; ``tier`` (NULL when unknown) ranks ongoing
    conflicts.
    """

    id: uuid.UUID
    name: str
    wikidata_id: str | None
    start_year: int | None
    end_year: int | None
    tier: ConflictTier | None
    ongoing: bool

    model_config = {"from_attributes": True}
