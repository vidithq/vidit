"""content reports + takedown

Revision ID: w5y7a9c1e3g5
Revises: v4x6z8b0d2f4
Create Date: 2026-08-12 11:00:00.000000

``content_reports`` is the viewer-facing flag queue: anyone, signed in or not,
reports an event, and an admin resolves the row with one of three verdicts. The
row is never deleted, so the table doubles as the record of what was reported
and what was decided. The partial index serves the queue's read (open reports,
newest first) and stays small as the resolved cohort grows.

``events.hidden_at`` is the takedown itself: a stamped row drops off every
public read the way a soft-deleted one does, and an admin can clear it again.
No index on it: it is a residual predicate on reads the existing indexes
already serve, and the withheld cohort is a handful of rows.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w5y7a9c1e3g5"
down_revision: Union[str, None] = "v4x6z8b0d2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "content_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.String(length=30), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("reporter_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.String(length=30), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "reason IN ('illegal_content', 'graphic_not_flagged',"
            " 'copyright', 'privacy', 'other')",
            name="ck_content_reports_reason_valid",
        ),
        sa.CheckConstraint(
            "resolution IS NULL OR resolution IN ('marked_graphic', 'hidden', 'dismissed')",
            name="ck_content_reports_resolution_valid",
        ),
        sa.CheckConstraint(
            "(resolution IS NULL AND resolved_at IS NULL)"
            " OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_content_reports_resolution_stamp",
        ),
    )
    op.create_index(op.f("ix_content_reports_event_id"), "content_reports", ["event_id"])
    op.create_index(
        "ix_content_reports_open_created_at",
        "content_reports",
        ["created_at"],
        postgresql_where=sa.text("resolved_at IS NULL"),
    )

    op.add_column(
        "events",
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "hidden_at")
    op.drop_index("ix_content_reports_open_created_at", table_name="content_reports")
    op.drop_index(op.f("ix_content_reports_event_id"), table_name="content_reports")
    op.drop_table("content_reports")
