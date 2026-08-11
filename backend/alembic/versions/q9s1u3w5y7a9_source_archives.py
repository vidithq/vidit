"""source archives

Revision ID: q9s1u3w5y7a9
Revises: p8r0t2v4x6z8
Create Date: 2026-08-11 12:00:00.000000

One row per link carried by an event (its ``source_url`` plus every href in
the proof body), holding both the archival job and its result. The write paths
insert ``queued`` rows; the worker claims them (``FOR UPDATE SKIP LOCKED``),
calls the Wayback Machine, and stamps ``archived_url`` in place, so a deleted
source tweet still has a readable copy.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q9s1u3w5y7a9"
down_revision: Union[str, None] = "p8r0t2v4x6z8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "source_archives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("original_url", sa.Text(), nullable=False),
        sa.Column("origin", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("archived_url", sa.Text(), nullable=True),
        sa.Column("provider", sa.String(length=20), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "original_url", name="uq_source_archives_event_url"),
        sa.CheckConstraint(
            "(status = 'done' AND archived_url IS NOT NULL)"
            " OR (status <> 'done' AND archived_url IS NULL)",
            name="ck_source_archives_done_url",
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')",
            name="ck_source_archives_status_valid",
        ),
        sa.CheckConstraint(
            "origin IN ('source_url', 'proof_link')",
            name="ck_source_archives_origin_valid",
        ),
    )
    op.create_index(op.f("ix_source_archives_event_id"), "source_archives", ["event_id"])
    op.create_index(
        "ix_source_archives_status_next_attempt",
        "source_archives",
        ["status", "next_attempt_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_source_archives_status_next_attempt", table_name="source_archives")
    op.drop_index(op.f("ix_source_archives_event_id"), table_name="source_archives")
    op.drop_table("source_archives")
