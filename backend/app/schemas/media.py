import uuid

from pydantic import BaseModel

from app.models.media import MediaKind, MediaRole


class MediaRead(BaseModel):
    id: uuid.UUID
    # Read from ``Media.role``, derived from the set parent key; only a source image has display
    # derivatives.
    role: MediaRole
    storage_url: str
    kind: MediaKind
    # Hex SHA-256 of the stored bytes.
    sha256: str
    # Public so investigators can trace evidence to a post by filename.
    original_filename: str | None = None

    model_config = {"from_attributes": True}
