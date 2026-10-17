import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.approval import ApprovalRevoker, ApprovalVerdict
from app.schemas.notification import NotificationEventRef
from app.schemas.organization import OrganizationRef
from app.schemas.user import AuthorRef

APPROVAL_NOTE_MAX_LENGTH = 280
REVOKE_REASON_MAX_LENGTH = 2000


class ApprovalCreate(BaseModel):
    """Body of ``POST /events/{id}/approvals``: the version you read, an optional note, and the
    slug of the organization you approve for as its org manager (your own approval without it)."""

    model_config = ConfigDict(extra="forbid")

    version_no: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=APPROVAL_NOTE_MAX_LENGTH)
    organization: str | None = Field(default=None, min_length=1, max_length=50)

    @field_validator("note")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class ApprovalRevoke(BaseModel):
    """Optional body of ``POST /events/{id}/approvals/{approval_id}/revoke``: a public reason,
    stored as null when blank."""

    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=REVOKE_REASON_MAX_LENGTH)

    @field_validator("reason")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class ApprovalRead(BaseModel):
    """One review of one version of an event.

    ``organization`` is the organization the review was placed for, with
    ``reviewer`` the org manager who placed it; null for an analyst's own review.
    ``reviewer`` is null on an organization's review once the account of the
    org manager who placed it is erased: the review stays the organization's.
    ``current`` is true while the review covers the live version and is not
    revoked. ``revoked_as`` says who revoked it: the reviewer, an org manager of
    the organization, or a site admin.
    """

    id: uuid.UUID
    version_no: int
    verdict: ApprovalVerdict
    reviewer: AuthorRef | None
    organization: OrganizationRef | None
    note: str | None
    created_at: datetime
    current: bool
    revoked_at: datetime | None
    revoke_reason: str | None
    revoked_as: ApprovalRevoker | None


class ApprovalList(BaseModel):
    """``GET /events/{id}/approvals``: the reviews, and whether the caller may approve the
    event at all. ``viewer_can_approve`` is false for an anonymous caller, an event that is not
    published, and an analyst who holds or held credit on it; whether the caller already
    reviewed the live version reads from ``items``."""

    items: list[ApprovalRead]
    viewer_can_approve: bool


class OrganizationApprovalRead(BaseModel):
    """One approval an org manager placed in an organization's name, with the event it covers,
    for ``GET /organizations/{slug}/approvals``."""

    event: NotificationEventRef
    approval: ApprovalRead
