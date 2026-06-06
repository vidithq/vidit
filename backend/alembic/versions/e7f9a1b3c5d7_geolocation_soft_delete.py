"""geolocations.deleted_at — soft delete

Revision ID: e7f9a1b3c5d7
Revises: d4e6f8a0b2c4
Create Date: 2026-05-09 16:30:00.000000

Soft-delete on geolocations matches the platform's evidence-preservation
promise (per docs/next.md → Security gaps) — admins remove a
submission from public view while leaving the row + its proof / S3
objects intact for forensic recall. ``DELETE /admin/geolocations/{id}``
flips ``deleted_at`` by default; the ``?hard=true`` toggle is the GDPR
escape hatch (true row + S3 erasure).

Read paths gain ``WHERE deleted_at IS NULL`` everywhere (list, points,
detail, profile feed, profile-count). The partial index keeps those
reads cheap as the soft-deleted cohort grows.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e7f9a1b3c5d7"
down_revision: Union[str, None] = "d4e6f8a0b2c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "geolocations",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Partial index — every list / map / profile read filters
    # ``deleted_at IS NULL``, and the soft-deleted cohort is expected to
    # stay a small minority of total rows. Dropping deleted rows from the
    # index keeps it tight.
    op.create_index(
        "ix_geolocations_live",
        "geolocations",
        ["created_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_geolocations_live", table_name="geolocations")
    op.drop_column("geolocations", "deleted_at")
