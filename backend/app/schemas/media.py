import uuid

from pydantic import BaseModel

from app.models.media import MediaRole, MediaType


class MediaRead(BaseModel):
    id: uuid.UUID
    role: MediaRole
    storage_url: str
    media_type: MediaType
    # Hex-encoded SHA-256 of the uploaded bytes. ``None`` for pre-column rows
    # and demo-pool references with no upload pass (full rationale in
    # ``models/media.py::Media.sha256``).
    sha256: str | None = None
    # Original filename the browser sent at upload. Exposed publicly because
    # investigators sometimes trace evidence to a source post by filename
    # (``IMG_1234.jpg`` referenced in a tweet).
    original_filename: str | None = None

    model_config = {"from_attributes": True}
