import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.review_request import ReviewRequestStatus
from app.schemas.user import AuthorRef


class ReviewRequestCreate(BaseModel):
    """Body of ``POST /events/{id}/review-requests``: the analyst you ask to review the event."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=50)


class ReviewRequestRead(BaseModel):
    """One request that ``target`` review an event. ``version_no`` is the live version when it
    was sent; approving any version resolves it."""

    id: uuid.UUID
    event_id: uuid.UUID
    version_no: int
    requester: AuthorRef
    target: AuthorRef
    status: ReviewRequestStatus
    created_at: datetime
    resolved_at: datetime | None
