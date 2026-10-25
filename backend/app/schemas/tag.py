import uuid
from typing import Annotated

from pydantic import BaseModel, StringConstraints


class TagCreate(BaseModel):
    # User-typed. ``strip_whitespace`` stops `"  drone  "` duplicating
    # `"drone"`; the bounds match the `String(100)` column (mirrored by
    # ``frontend/src/components/ui/TagPicker.tsx::TAG_NAME_MAX_LEN``). Dedup is
    # case-sensitive, per the unique constraint on `tags.name`.
    name: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    ]


class TagRead(BaseModel):
    id: uuid.UUID
    name: str

    model_config = {"from_attributes": True}
