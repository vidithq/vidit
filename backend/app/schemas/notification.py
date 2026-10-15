import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.notification import NotificationKind
from app.schemas.organization import OrganizationRef
from app.schemas.user import AuthorRef
from app.services.pagination import MAX_PAGE_SIZE


class NotificationEventRef(BaseModel):
    id: uuid.UUID
    title: str

    model_config = ConfigDict(from_attributes=True)


class NotificationRead(BaseModel):
    """One feed row. ``actor``, ``event`` and ``organization`` are null on a
    kind that names none; ``read_at`` is null until the feed has shown the row.
    ``invite_pending`` is true on a ``co_geolocator_invite`` row whose
    invitation still waits for the reader's answer. ``reapprove_version`` is
    the live version a ``re_approve_requested`` row, or a
    ``review_request_received`` row whose request is open, offers to approve,
    null when the reader cannot approve it now. ``approved_version`` is then,
    on a ``re_approve_requested`` row, the latest earlier version the reader's
    approval still stands on, the base of the change list. ``review_request_id`` is the open request behind a
    ``review_request_received`` row, null once it is resolved."""

    id: uuid.UUID
    kind: NotificationKind
    created_at: datetime
    actor: AuthorRef | None
    event: NotificationEventRef | None
    organization: OrganizationRef | None
    read_at: datetime | None
    invite_pending: bool
    reapprove_version: int | None
    approved_version: int | None
    review_request_id: uuid.UUID | None


class NotificationUnreadCount(BaseModel):
    count: int


class NotificationReadUpdate(BaseModel):
    """Body for ``POST /notifications/read``: the rows the feed displayed, at
    most one page."""

    model_config = ConfigDict(extra="forbid")

    ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_PAGE_SIZE)
