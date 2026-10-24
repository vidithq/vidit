"""remove web push

Revision ID: 6a3943ca4316
Revises: 361664db5722
Create Date: 2026-10-24 09:00:00.000000

Email is the only notification channel besides the in-app feed. The push
device tables go, ``notification_deliveries`` loses its ``channel`` column and
holds at most one row per notification, and the stored notification overrides
become one email switch per kind: ``{kind: {"email": bool, "push": bool}}``
turns into ``{kind: bool}``, keeping the email value and dropping a kind that
only overrode push.

The downgrade recreates the push tables empty and stores every switch back as
``{"email": bool}``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6a3943ca4316"
down_revision: Union[str, None] = "361664db5722"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CHANNEL_CHECK = "ck_notification_deliveries_channel_valid"
_CHANNEL_UNIQUE = "uq_notification_deliveries_channel"
_NOTIFICATION_UNIQUE = "uq_notification_deliveries_notification_id"


def upgrade() -> None:
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_table("revoked_push_endpoints")

    op.execute("DELETE FROM notification_deliveries WHERE channel <> 'email'")
    op.drop_constraint(_CHANNEL_UNIQUE, "notification_deliveries", type_="unique")
    op.drop_constraint(_CHANNEL_CHECK, "notification_deliveries", type_="check")
    op.drop_column("notification_deliveries", "channel")
    op.create_unique_constraint(
        _NOTIFICATION_UNIQUE, "notification_deliveries", ["notification_id"]
    )

    op.execute(
        """
        UPDATE user_preferences SET notification_overrides = COALESCE(
            (
                SELECT jsonb_object_agg(o.key, o.value -> 'email')
                FROM jsonb_each(notification_overrides) AS o
                WHERE jsonb_typeof(o.value) = 'object'
                  AND jsonb_typeof(o.value -> 'email') = 'boolean'
            ),
            '{}'::jsonb
        )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE user_preferences SET notification_overrides = COALESCE(
            (
                SELECT jsonb_object_agg(o.key, jsonb_build_object('email', o.value))
                FROM jsonb_each(notification_overrides) AS o
                WHERE jsonb_typeof(o.value) = 'boolean'
            ),
            '{}'::jsonb
        )
        """
    )

    op.drop_constraint(_NOTIFICATION_UNIQUE, "notification_deliveries", type_="unique")
    op.add_column(
        "notification_deliveries",
        sa.Column("channel", sa.String(length=20), nullable=False, server_default="email"),
    )
    op.alter_column("notification_deliveries", "channel", server_default=None)
    op.create_check_constraint(
        _CHANNEL_CHECK, "notification_deliveries", "channel IN ('email', 'push')"
    )
    op.create_unique_constraint(
        _CHANNEL_UNIQUE, "notification_deliveries", ["notification_id", "channel"]
    )

    op.create_table(
        "revoked_push_endpoints",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint_sha256", sa.String(length=64), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "endpoint_sha256"),
    )
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
        sa.Column("refusals", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])
