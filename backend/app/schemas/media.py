import uuid

from pydantic import BaseModel

from app.models.media import MediaKind


class MediaRead(BaseModel):
    id: uuid.UUID
    storage_url: str
    kind: MediaKind
    # Hex SHA-256 of the stored bytes.
    sha256: str
    # Public so investigators can trace evidence to a post by filename.
    original_filename: str | None = None

    model_config = {"from_attributes": True}
