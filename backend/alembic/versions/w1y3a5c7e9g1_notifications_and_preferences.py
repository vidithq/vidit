"""add notifications and user_preferences

Revision ID: w1y3a5c7e9g1
Revises: u9w1y3a5c7e9
Create Date: 2026-10-14 10:00:00.000000

``notifications`` holds one row per thing that happened to an analyst, written
in the transaction of the action that caused it. ``kind`` names what happened,
pinned by ``ck_notifications_kind_valid`` to the kind registry in
``models/notification``; a kind added later widens the constraint in its own
migration. ``actor_id`` and ``event_id`` are typed foreign keys, nullable
because not every kind names both. Each one cascades, so a hard-deleted actor
or event takes its rows along. A soft delete or a takedown is filtered at read
time instead, so undoing it brings the row back.

``notifications.read_at`` is the read state, one per row: the feed sets it on
the rows it showed, and NULL is unread. A single per-user marker compared with
``created_at`` would hide a row whose action flushed before a slow upload and
committed after the marker moved past it. A partial index on ``user_id`` where
``read_at IS NULL`` backs the unread count.

``user_preferences`` holds one row per analyst, created on the first write.
``notification_overrides`` stores only the per-kind, per-channel values that
differ from the registry default, so a default can move for every analyst who
never touched it. ``display`` holds the accent palette, the theme and the help
tooltip switch. A missing row reads as the defaults, so no backfill runs.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "w1y3a5c7e9g1"
down_revision: Union[str, None] = "u9w1y3a5c7e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('request_fulfilled', 'new_follower')",
            name="ck_notifications_kind_valid",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notifications_user_created_at",
        "notifications",
        ["user_id", "created_at", "id"],
    )
    op.create_index(
        "ix_notifications_user_unread",
        "notifications",
        ["user_id"],
        postgresql_where=sa.text("read_at IS NULL"),
    )
    op.create_index("ix_notifications_actor_id", "notifications", ["actor_id"])
    op.create_index("ix_notifications_event_id", "notifications", ["event_id"])

    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "notification_overrides",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "display",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
    op.drop_index("ix_notifications_event_id", table_name="notifications")
    op.drop_index("ix_notifications_actor_id", table_name="notifications")
    op.drop_index("ix_notifications_user_unread", table_name="notifications")
    op.drop_index("ix_notifications_user_created_at", table_name="notifications")
    op.drop_table("notifications")
