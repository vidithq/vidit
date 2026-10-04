import uuid

from pydantic import BaseModel

from app.models.media import MediaRole, MediaType


class MediaRead(BaseModel):
    id: uuid.UUID
    role: MediaRole
    storage_url: str
    media_type: MediaType
    # Hex SHA-256; ``None`` on rows predating the column (``models/media.py``).
    sha256: str | None = None
    # Public so investigators can trace evidence to a post by filename.
    original_filename: str | None = None

    model_config = {"from_attributes": True}
