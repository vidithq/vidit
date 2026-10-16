import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.notification import NotificationKind
from app.schemas.user import AuthorRef
from app.services.pagination import MAX_PAGE_SIZE


class NotificationEventRef(BaseModel):
    id: uuid.UUID
    title: str

    model_config = ConfigDict(from_attributes=True)


class NotificationRead(BaseModel):
    """One feed row. ``actor`` and ``event`` are null on a kind that names
    neither; ``read_at`` is null until the feed has shown the row."""

    id: uuid.UUID
    kind: NotificationKind
    created_at: datetime
    actor: AuthorRef | None
    event: NotificationEventRef | None
    read_at: datetime | None


class NotificationUnreadCount(BaseModel):
    count: int


class NotificationReadUpdate(BaseModel):
    """Body for ``POST /notifications/read``: the rows the feed displayed, at
    most one page."""

    model_config = ConfigDict(extra="forbid")

    ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_PAGE_SIZE)
