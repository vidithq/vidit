import uuid

from pydantic import BaseModel

from app.models.media import MediaType


class MediaRead(BaseModel):
    id: uuid.UUID
    storage_url: str
    media_type: MediaType
    # Hex-encoded SHA-256 of the uploaded bytes. ``None`` for pre-column rows
    # and demo-pool references with no upload pass (full rationale in
    # ``models/media.py::Media.sha256``).
    sha256: str | None = None
    # Original filename the browser sent at upload. Exposed publicly because
    # investigators sometimes trace evidence to a source post by filename
    # (``IMG_1234.jpg`` referenced in a tweet). The other provenance columns
    # (``uploaded_ip``, ``uploaded_user_agent``) are admin-only, never
    # serialised here.
    original_filename: str | None = None

    model_config = {"from_attributes": True}


class MediaUploadResponse(BaseModel):
    url: str
    # Returned with the URL so the client (or an auditor replaying the upload)
    # can confirm the bytes that landed on S3 match what they sent.
    sha256: str
