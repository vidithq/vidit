import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.notification import NotificationKind
from app.schemas.organization import OrganizationRef
from app.schemas.user import AuthorRef
from app.services.pagination import MAX_PAGE_SIZE

# The answers a feed row reports on the approval request behind it.
ApprovalRequestOutcome = Literal["approved", "declined"]


class NotificationEventRef(BaseModel):
    id: uuid.UUID
    title: str

    model_config = ConfigDict(from_attributes=True)


class NotificationRead(BaseModel):
    """One feed row. ``actor``, ``event`` and ``organization`` are null on a
    kind that names none; ``read_at`` is null until the feed has shown the row.
    ``approval_request_status`` is ``approved`` or ``declined`` on the newest
    ``approval_request_received`` row of a request that was answered.
    ``organization_name`` names the deleted organization on an
    ``organization_approval_removed`` row, and is null on every other kind."""

    id: uuid.UUID
    kind: NotificationKind
    created_at: datetime
    actor: AuthorRef | None
    event: NotificationEventRef | None
    organization: OrganizationRef | None
    organization_name: str | None = None
    read_at: datetime | None
    approval_request_status: ApprovalRequestOutcome | None = None


class NotificationUnreadCount(BaseModel):
    count: int


class NotificationReadUpdate(BaseModel):
    """Body for ``POST /notifications/read``: the rows the feed displayed, at
    most one page."""

    model_config = ConfigDict(extra="forbid")

    # Mirrored by the frontend's lib/notifications MAX_READ_IDS; change both.
    ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_PAGE_SIZE)
