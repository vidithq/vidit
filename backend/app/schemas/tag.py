import uuid
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.models.tag import TagCategory


class TagCreate(BaseModel):
    # User-typed. ``strip_whitespace`` stops `"  drone  "` duplicating
    # `"drone"`; the bounds match the `String(100)` column (mirrored by
    # ``frontend/src/components/ui/TagPicker.tsx::TAG_NAME_MAX_LEN``). Dedup is
    # case-sensitive, per the unique constraint on `tags.name`.
    name: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    ]
    # ``str``, not ``TagCategory``: the router answers a non-creatable or
    # unknown category with a specific 403, and the Literal would turn it into a
    # 422. Only ``TagRead`` carries the enum (OpenAPI to frontend type).
    category: str


class TagRead(BaseModel):
    id: uuid.UUID
    name: str
    category: TagCategory

    model_config = {"from_attributes": True}
