"""bot webhook events queue

Revision ID: n6p8r0t2v4x6
Revises: m5o7q9s1u3w5
Create Date: 2026-07-18 12:00:00.000000

The small queue between the X Account Activity webhook endpoint (which must
answer fast and therefore only inserts) and the import worker's drain, which
runs the shared mention pipeline. Idempotency stays in ``bot_mentions``. See
``models/bot_webhook_event`` and ``services/bot``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "n6p8r0t2v4x6"
down_revision: Union[str, None] = "m5o7q9s1u3w5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bot_webhook_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mention", JSONB(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_bot_webhook_events_status"), "bot_webhook_events", ["status"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_bot_webhook_events_status"), table_name="bot_webhook_events")
    op.drop_table("bot_webhook_events")
