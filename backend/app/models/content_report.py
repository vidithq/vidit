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
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check

# Why a viewer flagged an event, a collection or a site. ``illegal_content`` is the legal
# escalation; ``graphic_not_flagged`` is footage of death, injury or human
# remains without the author's ``sources.is_graphic``; ``copyright`` and
# ``privacy`` are third-party rights claims; ``other`` relies on ``details``.
# One set for both targets. Value-domain source of truth for the column, the
# Create schema and the generated frontend type.
ContentReportReason = Literal[
    "illegal_content",
    "graphic_not_flagged",
    "copyright",
    "privacy",
    "other",
]

# What an admin did. ``marked_graphic`` sets the event's graphic flag over the
# author's declaration; ``hidden`` takes the target off every public read
# (``events.hidden_at``, ``collections.hidden_at``, ``sites.hidden_at``); ``dismissed`` leaves it
# untouched. Reports are resolved, never deleted (an audit trail).
# ``marked_graphic`` is an event-only verdict (refused in ``services/reports``).
ContentReportResolution = Literal["marked_graphic", "hidden", "dismissed"]


class ContentReport(Base):
    """One viewer's report against one event, collection or site.

    Open to anonymous viewers (a takedown request must not need an account);
    ``reporter_id`` is NULL unless the reporter was logged in.

    One row names one target, ``event_id``, ``collection_id`` or ``site_id``,
    and all share one queue. Two real foreign keys rather than a ``(target_type, target_id)``
    pair, so the database keeps the pointer valid and empties it on destroy.

    Several reports may name one target, each resolved on its own. "Open" is
    exactly ``resolved_at IS NULL`` (``ck_content_reports_resolution_stamp``).
    """

    __tablename__ = "content_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # NULL once the event is hard-deleted. SET NULL, not CASCADE: the report
    # records that a complaint was filed and answered. An orphan can only be
    # resolved as ``dismissed``.
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Same terms as ``event_id``; NULL for an event report. Empties only when the
    # owner's account is erased (``owner_id`` cascades).
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("collections.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Same terms as ``event_id``; NULL for any other report.
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True
    )
    reason: Mapped[ContentReportReason] = mapped_column(String(30), nullable=False)
    # The reporter's own words; capped at 2000 characters in the schema, not the column.
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL for an anonymous report. SET NULL: the report outlives the account (GDPR erasure).
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
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
    # NULL until resolved, and after a GDPR erasure of that admin.
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Read by the admin queue to name a collection or site report (title or name, and
    # owner). No ``event`` relationship: an event report carries its id and links out.
    collection = relationship("Collection")
    site = relationship("Site")

    __table_args__ = (
        literal_check("reason", ContentReportReason, "ck_content_reports_reason_valid"),
        literal_check(
            "resolution",
            ContentReportResolution,
            "ck_content_reports_resolution_valid",
            nullable=True,
        ),
        # Verdict and timestamp travel together, so "open" is a single-column test.
        CheckConstraint(
            "(resolution IS NULL AND resolved_at IS NULL)"
            " OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_content_reports_resolution_stamp",
        ),
        # "Never both", not "exactly one": both columns are SET NULL, so a report
        # whose target is destroyed names neither and must stay legal. Exactly
        # one holds at insert.
        CheckConstraint(
            "num_nonnulls(event_id, collection_id, site_id) <= 1",
            name="ck_content_reports_one_target",
        ),
        # The admin queue read, matching its ORDER BY (``services.reports.list_reports``):
        # open first, newest first, id as tie-break. A partial index on the open
        # cohort can't serve a sort over the whole table.
        Index(
            "ix_content_reports_queue",
            text("(resolved_at IS NOT NULL)"),
            text("created_at DESC"),
            text("id DESC"),
        ),
    )
