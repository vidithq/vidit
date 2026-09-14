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

from app.database import Base

# Why a viewer flagged an event or a collection. ``illegal_content`` is the
# legal escalation (material whose hosting is itself unlawful);
# ``graphic_not_flagged`` says the footage shows death, injury or human remains
# without the author's ``events.is_graphic`` declaration; ``copyright`` and
# ``privacy`` are the rights claims of a third party; ``other`` keeps the form
# answerable when none of the four fits, with the free-text ``details``
# carrying the story. One set for both targets, so a reader reports a shelf in
# the words they report a piece of footage in. The alias is the value-domain
# source of truth: the column, the Create schema, and (via the OpenAPI spec)
# the generated frontend type all derive from it.
ContentReportReason = Literal[
    "illegal_content",
    "graphic_not_flagged",
    "copyright",
    "privacy",
    "other",
]

# What an admin did about the report. ``marked_graphic`` sets the event's
# graphic flag over the author's declaration; ``hidden`` takes the target off
# every public read surface (``events.hidden_at``, ``collections.hidden_at``);
# ``dismissed`` closes the report and leaves the target untouched. A report is
# never deleted, only resolved, so the queue is an audit trail rather than an
# inbox.
#
# ``marked_graphic`` is an event verdict only: the flag it sets is a column on
# ``events``, and a collection carries no footage of its own, only items each
# moderated on their own. The refusal lives in ``services/reports``.
ContentReportResolution = Literal["marked_graphic", "hidden", "dismissed"]


class ContentReport(Base):
    """One viewer's report against one event or one collection.

    Open to anonymous viewers: a takedown request must not require an account,
    since the people a piece of footage harms are rarely the people who hold
    one. ``reporter_user_id`` is recorded when the reporter happened to be
    logged in, and is NULL otherwise.

    One row names one target, ``event_id`` or ``collection_id``, and both go
    through the same queue: an admin walks one list and answers each row with
    the verdicts its target can take. Two columns rather than a
    ``(target_type, target_id)`` pair, because each is a real foreign key, so
    the database is what keeps a report pointing at a row that exists and what
    empties the pointer when that row is destroyed.

    Rows accumulate: several viewers may report the same target, and each
    report is resolved on its own. The resolution columns are all-or-nothing
    (see ``ck_content_reports_resolution_stamp``), so an "open" report is
    exactly one with ``resolved_at IS NULL``, which is what the admin queue
    orders on.
    """

    __tablename__ = "content_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The reported event, NULL once that event is hard-deleted. ``SET NULL``
    # rather than ``CASCADE``: the report is the record that a complaint was
    # filed and how it was answered, and destroying the event must not destroy
    # that record. An orphaned report can only be resolved as ``dismissed``,
    # since the other two verdicts mutate an event that is no longer there.
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # The reported collection, on the same terms as ``event_id`` above and NULL
    # for a report filed against an event. It empties when the collection goes,
    # which a collection only does with its owner's account (``owner_id``
    # cascades), and the report survives that erasure the way it survives an
    # event's.
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("collections.id", ondelete="SET NULL"), nullable=True, index=True
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

    # The reported collection itself, which the admin queue reads to name the
    # row: a collection has no public index an admin can recognise it by, so
    # the queue prints its title and its owner. There is no matching
    # ``event`` relationship, because an event report carries its id alone and
    # the queue links out to the page.
    collection = relationship("Collection")

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
        # One report names one target. "Never both" rather than "exactly one":
        # both columns are ``SET NULL``, so a report whose target is destroyed
        # ends up naming neither, and that orphan row has to stay legal. The
        # exactly-one half holds at insert, where the two report routes each
        # name one target.
        CheckConstraint(
            "num_nonnulls(event_id, collection_id) <= 1",
            name="ck_content_reports_one_target",
        ),
        # The admin queue's read, matched expression for expression to its
        # ORDER BY (see :func:`services.reports.list_reports`): open reports
        # first, then newest first, with the id breaking ties so the offset
        # walk is total. A partial index on the open cohort cannot serve this
        # sort, because the query orders the whole table.
        Index(
            "ix_content_reports_queue",
            text("(resolved_at IS NOT NULL)"),
            text("created_at DESC"),
            text("id DESC"),
        ),
    )
