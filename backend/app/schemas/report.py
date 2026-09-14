import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.content_report import ContentReportReason, ContentReportResolution
from app.schemas.user import AuthorRef

# Ceiling on the reporter's free text. Long enough for the story behind a
# copyright or privacy claim, short enough that the field is not a paste bin;
# the column itself stays unbounded ``Text``.
DETAILS_MAX_LENGTH = 2000


class ContentReportCreate(BaseModel):
    """Body for ``POST /events/{id}/report`` and ``POST /collections/{id}/report``.

    ``reason`` picks one of the five buckets (see ``ContentReportReason``);
    ``details`` is the reporter's own words, optional because the bucket alone
    is often the whole report. One body for both targets: what a reader says
    about a shelf is what they say about a piece of footage, and the path is
    what names the thing.
    """

    reason: ContentReportReason
    details: str | None = Field(default=None, max_length=DETAILS_MAX_LENGTH)


class ReportedCollection(BaseModel):
    """The reported collection, as the admin queue names it in a row.

    Read at queue time off the live collection rather than copied onto the
    report when it was filed, so a renamed collection reads under its current
    name. A collection page is not a public index the way an event's is: the
    queue prints the title and the owner so an admin can judge the row, and
    links out for the rest.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    owner: AuthorRef


class ContentReportRead(BaseModel):
    """One report as the admin queue reads it.

    ``resolved_at`` / ``resolution`` / ``resolved_by`` are all NULL while the
    report is open and all set once it is resolved (the DB holds them together),
    so ``resolved_at is None`` is the open test on the wire too.

    A row names one target. ``event_id`` is set for a report against an event
    and ``collection`` for one against a collection; both are NULL once that
    target is destroyed, which is the orphan row every report can become and
    which only ``dismissed`` closes.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # NULL once the reported event is hard-deleted: the report outlives it, so
    # the queue still shows what was complained about and what was decided.
    event_id: uuid.UUID | None
    # The reported collection, read off the row's own relationship. NULL for
    # an event report, and again once the collection is gone.
    collection: ReportedCollection | None = None
    reason: ContentReportReason
    details: str | None
    # NULL for an anonymous report, and again once the reporter's account is
    # erased.
    reporter_user_id: uuid.UUID | None
    created_at: datetime
    resolved_at: datetime | None
    resolution: ContentReportResolution | None


class ContentReportUpdate(BaseModel):
    """Body for ``POST /admin/reports/{id}/resolve``: the verdict.

    One of the three values of ``ContentReportResolution``. There is no
    re-resolve: a report already carrying a verdict is a 409.
    """

    resolution: ContentReportResolution


class ContentReportList(BaseModel):
    """One page of the admin report queue.

    Offset-paged rather than cursor-paged: the queue reads open reports first
    and then newest first within each group, and that leading group flag is not
    a column a keyset cursor can walk (the same reason
    ``GET /users/{username}/events`` pages by offset). ``total`` counts every
    report, resolved ones included, so the pager knows how far the queue runs.
    """

    items: list[ContentReportRead]
    total: int
    page: int
    per_page: int
