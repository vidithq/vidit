"""add bot_catch_up_cursor

Revision ID: c3e5a7b9d1f2
Revises: b6d2f8a4c0e7
Create Date: 2026-11-09 10:00:00.000000

``bot_catch_up_cursor`` holds one row: the newest mention id the last mentions
pull returned and the time of that pull. The catch-up reads from that id, and
the worker skips a pull while the last one is younger than the catch-up
interval. No backfill: the first pull derives its ``since_id`` from
``bot_mentions`` and writes the row.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e5a7b9d1f2"
down_revision: Union[str, None] = "b6d2f8a4c0e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bot_catch_up_cursor",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("newest_post_id", sa.BigInteger(), nullable=True),
        sa.Column("pulled_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_bot_catch_up_cursor_single_row"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("bot_catch_up_cursor")
