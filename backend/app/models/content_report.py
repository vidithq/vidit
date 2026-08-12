import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Why a viewer flagged an event. ``illegal_content`` is the legal escalation
# (material whose hosting is itself unlawful); ``graphic_not_flagged`` says the
# footage shows death, injury or human remains without the author's
# ``events.is_graphic`` declaration; ``copyright`` and ``privacy`` are the
# rights claims of a third party; ``other`` keeps the form answerable when none
# of the four fits, with the free-text ``details`` carrying the story. The alias
# is the value-domain source of truth: the column, the Create schema, and (via
# the OpenAPI spec) the generated frontend type all derive from it.
ContentReportReason = Literal[
    "illegal_content",
    "graphic_not_flagged",
    "copyright",
    "privacy",
    "other",
]

# What an admin did about the report. ``marked_graphic`` sets the event's
# graphic flag over the author's declaration; ``hidden`` takes the event off
# every public read surface (``events.hidden_at``); ``dismissed`` closes the
# report and leaves the event untouched. A report is never deleted, only
# resolved, so the queue is an audit trail rather than an inbox.
ContentReportResolution = Literal["marked_graphic", "hidden", "dismissed"]


class ContentReport(Base):
    """One viewer's report against one event.

    Open to anonymous viewers: a takedown request must not require an account,
    since the people a piece of footage harms are rarely the people who hold
    one. ``reporter_user_id`` is recorded when the reporter happened to be
    logged in, and is NULL otherwise.

    Rows accumulate: several viewers may report the same event, and each report
    is resolved on its own. The resolution columns are all-or-nothing (see
    ``ck_content_reports_resolution_stamp``), so an "open" report is exactly one
    with ``resolved_at IS NULL``, which is what the admin queue orders on.
    """

    __tablename__ = "content_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The reported event. CASCADE: a hard-deleted event takes its reports with
    # it, since there is nothing left to moderate.
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reason: Mapped[ContentReportReason] = mapped_column(String(30), nullable=False)
    # The reporter's own words. Optional, and bounded at the schema (2000
    # characters) rather than by the column, which stays ``Text``.
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL for an anonymous report. ``ondelete=SET NULL``: the report outlives
    # the reporter's account, including a GDPR erasure.
    reporter_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # See ``ContentReportResolution``; non-NULL exactly when ``resolved_at`` is.
    resolution: Mapped[ContentReportResolution | None] = mapped_column(String(30), nullable=True)
    # The admin who resolved it, NULL until then and again after a GDPR erasure
    # of that admin's account.
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        # Pin the value domains at the DB, not just the app-layer Literals, so a
        # bad write is rejected by Postgres. Mirrors ``ContentReportReason`` /
        # ``ContentReportResolution``; keep them in step.
        CheckConstraint(
            "reason IN ('illegal_content', 'graphic_not_flagged', 'copyright', 'privacy', 'other')",
            name="ck_content_reports_reason_valid",
        ),
        CheckConstraint(
            "resolution IS NULL OR resolution IN ('marked_graphic', 'hidden', 'dismissed')",
            name="ck_content_reports_resolution_valid",
        ),
        # The verdict and its timestamp travel together, both directions: a
        # resolved row can't forget what was decided, and an open row can't
        # carry a stale verdict. "Open" is therefore a single-column test.
        CheckConstraint(
            "(resolution IS NULL AND resolved_at IS NULL)"
            " OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_content_reports_resolution_stamp",
        ),
        # The admin queue's read: open reports, newest first. Partial on the
        # open cohort, which stays small because resolving is the whole point
        # of the queue while the resolved rows accumulate forever.
        Index(
            "ix_content_reports_open_created_at",
            "created_at",
            postgresql_where="resolved_at IS NULL",
        ),
    )
