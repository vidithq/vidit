import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.review_request import ReviewRequestStatus
from app.schemas.notification import NotificationEventRef
from app.schemas.organization import OrganizationRef
from app.schemas.user import AuthorRef


class ReviewRequestCreate(BaseModel):
    """Body of ``POST /events/{id}/review-requests``: the analyst (``username``) or the
    organization (``organization``, its slug) you ask to review the event. Exactly one."""

    model_config = ConfigDict(extra="forbid")

    username: str | None = Field(default=None, min_length=1, max_length=50)
    organization: str | None = Field(default=None, min_length=1, max_length=50)

    @model_validator(mode="after")
    def _one_target(self) -> "ReviewRequestCreate":
        if (self.username is None) == (self.organization is None):
            raise ValueError("Name exactly one target: username or organization")
        return self


class ReviewRequestRead(BaseModel):
    """One request that ``target`` (an analyst) or ``target_organization`` review an event;
    exactly one of the two is set. ``version_no`` is the live version when it was sent;
    approving any version resolves it."""

    id: uuid.UUID
    event_id: uuid.UUID
    version_no: int
    requester: AuthorRef
    target: AuthorRef | None
    target_organization: OrganizationRef | None
    status: ReviewRequestStatus
    created_at: datetime
    resolved_at: datetime | None


class ReviewRequestTargetList(BaseModel):
    """``GET /events/{id}/review-request-targets``: the analysts and the organizations you can
    ask to review the event now."""

    analysts: list[AuthorRef]
    organizations: list[OrganizationRef]


class OrganizationReviewRequestRead(BaseModel):
    """One open request addressed to an organization, with the event it names, for
    ``GET /organizations/{slug}/review-requests``."""

    event: NotificationEventRef
    request: ReviewRequestRead
