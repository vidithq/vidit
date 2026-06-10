import uuid
from typing import Annotated

from pydantic import BaseModel, StringConstraints


class TagCreate(BaseModel):
    # Free-tag names are user-typed. `strip_whitespace=True` trims before the
    # DB write so `"  drone  "` and `"drone"` don't duplicate, and the min/max
    # bound matches the `String(100)` column cap so the DB never rejects what
    # Pydantic accepted. Dedup stays case-sensitive (per the unique constraint
    # on `tags.name`).
    name: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    ]
    category: str


class TagRead(BaseModel):
    id: uuid.UUID
    name: str
    category: str

    model_config = {"from_attributes": True}
