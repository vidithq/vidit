import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.user import normalise_url

# ``MAJOR.MINOR.0``: a major release, never a patch.
RELEASE_LABEL_PATTERN = r"^\d+\.\d+\.0$"


class ProductUpdateCreate(BaseModel):
    """An announcement as the admin composes it. ``body`` is plain text: a blank
    line starts a paragraph, and a paragraph whose lines all start with ``- ``
    is a list."""

    model_config = ConfigDict(extra="forbid")

    label: Annotated[str, Field(pattern=RELEASE_LABEL_PATTERN, max_length=20)]
    # Mirrored by frontend PRODUCT_UPDATE_TITLE_MAX_LEN / PRODUCT_UPDATE_BODY_MAX_LEN; change both.
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
    link_url: str | None = None

    @field_validator("link_url")
    @classmethod
    def _http_link(cls, v: str | None) -> str | None:
        return normalise_url(v, field="link_url")


class ProductUpdatePreview(BaseModel):
    """The email as a recipient gets it, and the audience it would go to now.
    ``days`` is how many trailing-24-hour windows the daily cap needs."""

    subject: str
    html: str
    text: str
    recipients: int
    daily_cap: int
    batch_size: int
    days: int


class ProductUpdateProgress(BaseModel):
    queued: int = 0
    sending: int = 0
    sent: int = 0
    failed: int = 0
    skipped: int = 0


class ProductUpdateRead(BaseModel):
    id: uuid.UUID
    label: str
    title: str
    link_url: str | None
    created_at: datetime
    recipient_count: int
    progress: ProductUpdateProgress


class ProductUpdateList(BaseModel):
    """Every announcement sent, newest first."""

    items: list[ProductUpdateRead]
