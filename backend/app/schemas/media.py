import uuid

from pydantic import BaseModel


class MediaRead(BaseModel):
    id: uuid.UUID
    storage_url: str
    media_type: str
    # Hex-encoded SHA-256 of the uploaded bytes. ``None`` for rows
    # minted before the column landed and for demo-pool references
    # that don't go through an upload pass — see
    # ``models/media.py::Media.sha256`` for the full rationale.
    sha256: str | None = None
    # Original filename the analyst's browser sent at upload time.
    # Exposed on the public read API because investigators sometimes
    # trace evidence back to a source post by filename
    # (``IMG_1234.jpg`` referenced in a tweet, etc). The other
    # provenance columns — ``uploaded_ip``, ``uploaded_user_agent`` —
    # are deliberately admin-only and never serialised here.
    original_filename: str | None = None

    model_config = {"from_attributes": True}


class MediaUploadResponse(BaseModel):
    url: str
    # Returned alongside the URL so the client (and any auditor
    # replaying the upload) can confirm the bytes that landed on S3
    # match what they sent.
    sha256: str
