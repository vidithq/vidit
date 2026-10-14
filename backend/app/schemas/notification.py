import uuid
from datetime import datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict

from app.models.notification import NotificationKind
from app.schemas.user import AuthorRef


class NotificationEventRef(BaseModel):
    id: uuid.UUID
    title: str

    model_config = ConfigDict(from_attributes=True)


class NotificationRead(BaseModel):
    """One feed row. ``actor`` and ``event`` are null on a kind that names
    neither; ``unread`` compares ``created_at`` with the last-read marker."""

    id: uuid.UUID
    kind: NotificationKind
    created_at: datetime
    actor: AuthorRef | None
    event: NotificationEventRef | None
    unread: bool


class NotificationUnreadCount(BaseModel):
    count: int


class NotificationMarkerUpdate(BaseModel):
    """Body for ``POST /notifications/read``: the ``created_at`` of the newest
    row the reader was shown."""

    model_config = ConfigDict(extra="forbid")

    up_to: AwareDatetime
