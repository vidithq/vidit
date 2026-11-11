import uuid

from pydantic import BaseModel

from app.models.media import MediaKind, MediaRole


class MediaRead(BaseModel):
    id: uuid.UUID
    role: MediaRole
    storage_url: str
    kind: MediaKind
    sha256: str
    original_filename: str | None = None

    model_config = {"from_attributes": True}
