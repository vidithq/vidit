"""archive import jobs

Revision ID: l4n6p8r0t2v4
Revises: k3m5o7q9s1u3
Create Date: 2026-07-17 12:00:00.000000

The durable queue behind ``POST /events/import-archive``: the endpoint stages
the uploaded zip to storage and inserts a row here; the worker service claims
rows (``FOR UPDATE SKIP LOCKED``), runs the backfill, stamps the assemble
counts, and emails the owner. Replaces the synchronous in-request import.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "l4n6p8r0t2v4"
down_revision: Union[str, None] = "k3m5o7q9s1u3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "archive_import_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("zip_key", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("post_estimate", sa.Integer(), nullable=True),
        sa.Column("progress_done", sa.Integer(), nullable=False),
        sa.Column("progress_total", sa.Integer(), nullable=True),
        sa.Column("created_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("recreated_count", sa.Integer(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_archive_import_jobs_owner_id"), "archive_import_jobs", ["owner_id"]
    )
    op.create_index(op.f("ix_archive_import_jobs_status"), "archive_import_jobs", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_archive_import_jobs_status"), table_name="archive_import_jobs")
    op.drop_index(op.f("ix_archive_import_jobs_owner_id"), table_name="archive_import_jobs")
    op.drop_table("archive_import_jobs")
