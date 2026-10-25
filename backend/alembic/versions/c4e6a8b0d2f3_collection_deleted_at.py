"""keep a deleted collection under an open report

Revision ID: c4e6a8b0d2f3
Revises: a2c4e6f8b0d1
Create Date: 2026-10-25 12:00:00.000000

An owner's delete of a collection that an open content report names stamps
``collections.deleted_at`` instead of dropping the row, so moderators keep the
evidence; resolving the last open report erases it. The downgrade erases every
collection still waiting on a report: the owner asked for its deletion, and the
old schema has no other way to withhold it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e6a8b0d2f3"
down_revision: Union[str, None] = "a2c4e6f8b0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "collections",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.execute("DELETE FROM collections WHERE deleted_at IS NOT NULL")
    op.drop_column("collections", "deleted_at")
