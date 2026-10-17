import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.x_handle_request import XHandleRequestStatus
from app.schemas import OptionalText
from app.schemas.admin import AdminUserRead, normalize_x_handle

# Ceiling on both free-text reasons. Mirrored by
# ``frontend/src/lib/xHandle.ts::X_HANDLE_REASON_MAX_LEN``.
REASON_MAX_LENGTH = 500


class XHandleRequestCreate(BaseModel):
    """Body for ``PUT /users/me/x-handle-request``."""

    model_config = ConfigDict(extra="forbid")

    x_handle: str
    reason: OptionalText = Field(default=None, max_length=REASON_MAX_LENGTH)

    @field_validator("x_handle")
    @classmethod
    def _normalize_handle(cls, v: str) -> str:
        normalized = normalize_x_handle(v)
        assert normalized is not None
        return normalized


class XHandleRequestRead(BaseModel):
    """The requester's view of their request. ``decline_reason`` and
    ``decided_at`` are set exactly when ``status`` is ``declined``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    x_handle: str
    reason: str | None
    status: XHandleRequestStatus
    decline_reason: str | None
    created_at: datetime
    decided_at: datetime | None


class XHandleRead(BaseModel):
    """Body of ``GET /users/me/x-handle``: the bound handle and the request
    waiting on it, if any."""

    x_handle: str | None
    request: XHandleRequestRead | None


class AdminXHandleRequestRead(BaseModel):
    """One pending request as the admin queue lists it, beside the account
    whose bound handle it would replace."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user: AdminUserRead
    x_handle: str
    reason: str | None
    created_at: datetime


class XHandleRequestDecline(BaseModel):
    """Body for ``POST /admin/x-handle-requests/{id}/decline``. The reason
    reaches the requester in Settings."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=REASON_MAX_LENGTH)

    @field_validator("reason")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("reason must not be blank")
        return cleaned
