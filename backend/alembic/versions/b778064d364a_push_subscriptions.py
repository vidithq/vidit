"""add push_subscriptions and the push delivery channel

Revision ID: b778064d364a
Revises: y3a5c7e9g1i3
Create Date: 2026-10-15 12:00:00.000000

``push_subscriptions`` holds one row per browser or installed app an analyst
registered for Web Push: the push service endpoint, the two encryption keys the
browser handed out, its user agent, and when a push last went through.
``endpoint`` is unique, so a browser that registers again under another account
moves to that account. A row goes with its user, and the worker deletes it when
the push service answers 404 or 410.

``ck_notification_deliveries_channel_valid`` widens to ``push``, so the
notification queue carries one row per notification for each channel.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b778064d364a"
down_revision: Union[str, None] = "y3a5c7e9g1i3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CHANNEL_CHECK = "ck_notification_deliveries_channel_valid"


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=128), nullable=False),
        sa.Column("auth", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])

    op.drop_constraint(_CHANNEL_CHECK, "notification_deliveries", type_="check")
    op.create_check_constraint(
        _CHANNEL_CHECK, "notification_deliveries", "channel IN ('email', 'push')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM notification_deliveries WHERE channel = 'push'")
    op.drop_constraint(_CHANNEL_CHECK, "notification_deliveries", type_="check")
    op.create_check_constraint(_CHANNEL_CHECK, "notification_deliveries", "channel IN ('email')")

    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
