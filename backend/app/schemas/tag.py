import uuid
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.models.tag import NAME_MAX_LENGTH


class TagCreate(BaseModel):
    # User-typed. ``strip_whitespace`` stops `"  drone  "` duplicating
    # `"drone"`. Dedup is case-sensitive, per the unique constraint on `tags.name`.
    name: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX_LENGTH),
    ]


class TagRead(BaseModel):
    id: uuid.UUID
    name: str

    model_config = {"from_attributes": True}
