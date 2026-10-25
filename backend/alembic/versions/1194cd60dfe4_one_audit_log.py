"""one audit log

Revision ID: 1194cd60dfe4
Revises: 67aeb29bb86d
Create Date: 2026-10-24 11:00:00.000000

``admin_events`` and ``auth_events`` merge into ``audit_log(id, actor_id,
action, target, created_at)``. An admin row keeps its actor, action and
target. An account row takes its account as ``actor_id``, its ``event`` as
``action`` and a NULL ``target``. Every row keeps its id and ``created_at``.

The downgrade splits the rows back: an account action (the fixed set below)
goes to ``auth_events``, every other row to ``admin_events``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1194cd60dfe4"
down_revision: Union[str, None] = "67aeb29bb86d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ACCOUNT_ACTIONS = (
    "'login', 'failed_login', 'logout', 'register_pending', 'register_resent', "
    "'register_confirmed', 'password_reset_requested', 'password_reset_completed', "
    "'password_changed'"
)


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        "INSERT INTO audit_log (id, actor_id, action, target, created_at) "
        "SELECT id, actor_id, action, target, created_at FROM admin_events"
    )
    op.execute(
        "INSERT INTO audit_log (id, actor_id, action, target, created_at) "
        "SELECT id, user_id, event, NULL, created_at FROM auth_events"
    )
    op.create_index("ix_audit_log_actor_id_created_at", "audit_log", ["actor_id", "created_at"])
    op.create_index("ix_audit_log_action_created_at", "audit_log", ["action", "created_at"])
    op.drop_table("admin_events")
    op.drop_table("auth_events")


def downgrade() -> None:
    op.create_table(
        "admin_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_events_actor_id", "admin_events", ["actor_id"])
    op.create_index("ix_admin_events_created_at", "admin_events", ["created_at"])
    op.create_table(
        "auth_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("event", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_events_user_id_created_at", "auth_events", ["user_id", "created_at"])
    op.create_index("ix_auth_events_event_created_at", "auth_events", ["event", "created_at"])
    op.execute(
        "INSERT INTO auth_events (id, user_id, event, created_at) "
        f"SELECT id, actor_id, action, created_at FROM audit_log WHERE action IN ({_ACCOUNT_ACTIONS})"
    )
    op.execute(
        "INSERT INTO admin_events (id, actor_id, action, target, created_at) "
        "SELECT id, actor_id, action, target, created_at FROM audit_log "
        f"WHERE action NOT IN ({_ACCOUNT_ACTIONS})"
    )
    op.drop_table("audit_log")
