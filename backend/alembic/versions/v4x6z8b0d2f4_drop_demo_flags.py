"""drop users.is_demo + events.is_demo

Revision ID: v4x6z8b0d2f4
Revises: u3w5y7a9c1e3
Create Date: 2026-08-13 10:00:00.000000

The synthetic demo seeder is gone: local test data comes from importing a real
X archive, so no row is flagged as throwaway any more. Drops both flags and the
partial indexes that served the bulk-wipe sweep.

Downgrade re-adds the columns with their ``false`` default and the partial
indexes. Every restored row reads ``is_demo = false``, since the flag's meaning
did not survive the drop.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v4x6z8b0d2f4"
down_revision: Union[str, None] = "u3w5y7a9c1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_events_demo", table_name="events")
    op.drop_column("events", "is_demo")
    op.drop_index("ix_users_demo", table_name="users")
    op.drop_column("users", "is_demo")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_demo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_users_demo",
        "users",
        ["id"],
        postgresql_where=sa.text("is_demo = true"),
    )
    op.add_column(
        "events",
        sa.Column(
            "is_demo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_events_demo",
        "events",
        ["id"],
        postgresql_where=sa.text("is_demo = true"),
    )
