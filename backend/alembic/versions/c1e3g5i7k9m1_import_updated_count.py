"""archive_import_jobs counts updated drafts instead of recreated ones

Revision ID: c1e3g5i7k9m1
Revises: b0d2f4h6j8l0
Create Date: 2026-08-14 09:00:00.000000

A re-import no longer recreates a dismissed detection, so ``recreated_count``
has nothing left to count. It is replaced by ``updated_count``: the open
``detected`` drafts a re-import overwrote with a newer parse.

The counts describe one finished import run, not the events it produced, so
the values do not carry over: the new column starts at zero for every job and
the old one is dropped.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1e3g5i7k9m1"
down_revision: Union[str, None] = "b0d2f4h6j8l0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "archive_import_jobs"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column("updated_count", sa.Integer(), nullable=False, server_default="0"),
    )
    # The default was only there to fill the existing rows; the model states it.
    op.alter_column(_TABLE, "updated_count", server_default=None)
    op.drop_column(_TABLE, "recreated_count")


def downgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column("recreated_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column(_TABLE, "recreated_count", server_default=None)
    op.drop_column(_TABLE, "updated_count")
