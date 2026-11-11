import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.content_report import ContentReportReason, ContentReportResolution
from app.schemas.user import AuthorRef

# Ceiling on the reporter's free text (the column is unbounded ``Text``).
# Mirrored by ``frontend/src/lib/events.ts::REPORT_DETAILS_MAX_LEN``.
DETAILS_MAX_LENGTH = 2000


class ContentReportCreate(BaseModel):
    """Body for ``POST /events/{id}/report``, ``POST /collections/{id}/report``
    and ``POST /sites/{id}/report``: the path names the target."""

    reason: ContentReportReason
    details: str | None = Field(default=None, max_length=DETAILS_MAX_LENGTH)


class ReportedEvent(BaseModel):
    """The reported event as the admin queue names it, read live so an edited
    title shows its current wording."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    owner: AuthorRef


class ReportedCollection(BaseModel):
    """The reported collection as the admin queue names it, read live so a
    renamed collection shows its current name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    owner: AuthorRef
    # Set once the owner deleted it under an open report: withheld from every
    # read but an admin's, and erased when its last open report is resolved.
    deleted_at: datetime | None


class ReportedSite(BaseModel):
    """The reported site as the admin queue names it, read live."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    owner: AuthorRef


class ContentReportRead(BaseModel):
    """One report as the admin queue reads it. A row names one target: ``event`` (with its
    ``event_id``), ``collection`` or ``site``, all NULL once the target is destroyed."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # NULL once the event is hard-deleted; the report outlives it.
    event_id: uuid.UUID | None
    # NULL for any other report, and once the event is hard-deleted.
    event: ReportedEvent | None = None
    # NULL for an event report, and once the collection is gone.
    collection: ReportedCollection | None = None
    # NULL for any other report, and once the site is gone.
    site: ReportedSite | None = None
    reason: ContentReportReason
    details: str | None
    # NULL for an anonymous report and after the reporter's erasure.
    reporter_id: uuid.UUID | None
    created_at: datetime
    resolved_at: datetime | None
    resolution: ContentReportResolution | None


class ContentReportUpdate(BaseModel):
    """Body for ``POST /admin/reports/{id}/resolve``."""

    resolution: ContentReportResolution


class ContentReportList(BaseModel):
    """One page of the admin report queue. Offset-paged: the leading open or resolved group flag
    is not a column a keyset cursor can walk."""

    items: list[ContentReportRead]
    total: int
    page: int
    per_page: int
