import uuid
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.models.tag import TagCategory


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
    # Deliberately ``str``, not ``TagCategory``: the router validates the value
    # against ``USER_CREATABLE_CATEGORIES`` and returns 403 with a specific
    # message for a non-creatable or unknown category. Narrowing this to the
    # Literal would shift "evil" from that 403 to a generic Pydantic 422 — a
    # behaviour change. Only the Read side (``TagRead``) carries the enum, which
    # is what the OpenAPI spec → frontend type derive from.
    category: str


class TagRead(BaseModel):
    id: uuid.UUID
    name: str
    category: TagCategory

    model_config = {"from_attributes": True}
