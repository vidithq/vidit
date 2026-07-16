import uuid

from pydantic import BaseModel

from app.models.conflict import ConflictTier


class ConflictRead(BaseModel):
    """One row of the conflicts referential on the wire.

    ``last_seen_at`` and ``source`` stay off the wire: they are sync-machinery
    internals, not product facts. ``ongoing`` drives the picker's default
    (ongoing first, ended behind a toggle); ``start_year`` / ``end_year``
    disambiguate same-named historical entries in the typeahead; ``tier``
    (Wikipedia death-toll tier, NULL when unknown) lets the picker rank
    ongoing conflicts by severity.
    """

    id: uuid.UUID
    name: str
    wikidata_id: str | None
    start_year: int | None
    end_year: int | None
    tier: ConflictTier | None
    ongoing: bool

    model_config = {"from_attributes": True}
