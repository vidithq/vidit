"""add notification_deliveries

Revision ID: y3a5c7e9g1i3
Revises: w1y3a5c7e9g1
Create Date: 2026-10-15 10:00:00.000000

``notification_deliveries`` is the email queue for notifications: one row per
notification and channel, written in the action's transaction when the
recipient's switch for that kind is on. The always-on worker claims ``queued``
rows oldest first and sends them after the action has committed. The partial
index on ``created_at`` backs the claim; the one on ``sent_at`` backs the
daily cap counts. No backfill: earlier notifications are never emailed.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "y3a5c7e9g1i3"
down_revision: Union[str, None] = "w1y3a5c7e9g1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("notification_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("channel IN ('email')", name="ck_notification_deliveries_channel_valid"),
        sa.CheckConstraint(
            "status IN ('queued', 'sending', 'sent', 'failed', 'skipped')",
            name="ck_notification_deliveries_status_valid",
        ),
        sa.ForeignKeyConstraint(["notification_id"], ["notifications.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "notification_id", "channel", name="uq_notification_deliveries_channel"
        ),
    )
    op.create_index(
        "ix_notification_deliveries_queued",
        "notification_deliveries",
        ["created_at"],
        postgresql_where=sa.text("status = 'queued'"),
    )
    op.create_index(
        "ix_notification_deliveries_sent_at",
        "notification_deliveries",
        ["sent_at"],
        postgresql_where=sa.text("status = 'sent'"),
    )


def downgrade() -> None:
    op.drop_index("ix_notification_deliveries_sent_at", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_queued", table_name="notification_deliveries")
    op.drop_table("notification_deliveries")
