import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.content_report import ContentReportReason, ContentReportResolution
from app.schemas.user import AuthorRef

# Ceiling on the reporter's free text (the column is unbounded ``Text``).
# Mirrored by ``frontend/src/lib/events.ts::REPORT_DETAILS_MAX_LEN``.
DETAILS_MAX_LENGTH = 2000


class ContentReportCreate(BaseModel):
    """Body for ``POST /events/{id}/report`` and ``POST /collections/{id}/report``.

    ``reason`` is one of ``ContentReportReason``; ``details`` is optional. One
    body for both targets, the path names the thing.
    """

    reason: ContentReportReason
    details: str | None = Field(default=None, max_length=DETAILS_MAX_LENGTH)


class ReportedCollection(BaseModel):
    """The reported collection as the admin queue names it, read live so a
    renamed collection shows its current name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    owner: AuthorRef


class ContentReportRead(BaseModel):
    """One report as the admin queue reads it.

    ``resolved_at`` / ``resolution`` / ``resolved_by`` are all NULL while open
    and all set once resolved, so ``resolved_at is None`` is the open test.

    A row names one target: ``event_id`` or ``collection``. Both are NULL once
    the target is destroyed (the orphan row, closed only by ``dismissed``).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # NULL once the event is hard-deleted; the report outlives it.
    event_id: uuid.UUID | None
    # NULL for an event report, and once the collection is gone.
    collection: ReportedCollection | None = None
    reason: ContentReportReason
    details: str | None
    # NULL for an anonymous report and after the reporter's erasure.
    reporter_user_id: uuid.UUID | None
    created_at: datetime
    resolved_at: datetime | None
    resolution: ContentReportResolution | None


class ContentReportUpdate(BaseModel):
    """Body for ``POST /admin/reports/{id}/resolve``: one of
    ``ContentReportResolution``. No re-resolve (409)."""

    resolution: ContentReportResolution


class ContentReportList(BaseModel):
    """One page of the admin report queue.

    Offset-paged: the leading open/resolved group flag isn't a column a keyset
    cursor can walk. ``total`` counts every report, resolved included.
    """

    items: list[ContentReportRead]
    total: int
    page: int
    per_page: int
