"""auth_events — append-only audit log for auth-relevant events

Revision ID: i5d7f9a1b3c5
Revises: h4c6e8f0a2b4
Create Date: 2026-05-11 12:00:00.000000

Tier 4 lite forensics primitive. Populated synchronously by
`services.audit.log_auth_event` on login, failed_login, logout,
register_pending, register_confirmed, password_reset_requested,
password_reset_completed.

Indexes target the two queries that actually matter on this table:
"what did this user do, latest first" and "did event X spike
recently". No DB-level enum on `event` — a new event kind shouldn't
require a migration.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import INET

revision: str = "i5d7f9a1b3c5"
down_revision: Union[str, None] = "h4c6e8f0a2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auth_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("event", sa.Text(), nullable=False),
        sa.Column("ip", INET(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_auth_events_user_id_created_at",
        "auth_events",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_auth_events_event_created_at",
        "auth_events",
        ["event", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_auth_events_event_created_at", table_name="auth_events")
    op.drop_index("ix_auth_events_user_id_created_at", table_name="auth_events")
    op.drop_table("auth_events")
