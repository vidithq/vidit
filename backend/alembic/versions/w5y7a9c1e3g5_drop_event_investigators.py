"""drop event_investigators

Revision ID: w5y7a9c1e3g5
Revises: v4x6z8b0d2f4
Create Date: 2026-08-13 12:00:00.000000

The "I'm working on this" signal is gone from the product: no endpoint writes
the table, no read surface renders it, and it never held a row in production.
Drops the table and its two indexes.

Downgrade recreates the table, the composite PK, both foreign keys, and both
indexes. It restores no rows: the signal is transient by nature and the data
did not survive the drop.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w5y7a9c1e3g5"
down_revision: Union[str, None] = "v4x6z8b0d2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_event_investigators_user_id", table_name="event_investigators")
    op.drop_index(
        "ix_event_investigators_event_id_created_at", table_name="event_investigators"
    )
    op.drop_table("event_investigators")


def downgrade() -> None:
    op.create_table(
        "event_investigators",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "user_id"),
    )
    op.create_index(
        "ix_event_investigators_event_id_created_at",
        "event_investigators",
        ["event_id", "created_at"],
    )
    op.create_index("ix_event_investigators_user_id", "event_investigators", ["user_id"])
