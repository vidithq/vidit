"""bot mentions ledger

Revision ID: k3m5o7q9s1u3
Revises: j2l4n6p8r0t2
Create Date: 2026-07-16 12:00:00.000000

The bot's idempotency ledger: one row per processed @-mention, whatever the
outcome, so a poll never re-processes (or re-bills) a tweet it has already
seen. ``mention_tweet_id`` UNIQUE is the guarantee; ``max()`` over its numeric
cast is the ``since_id`` cursor for the next pull. See ``models/bot_mention``
and ``services/bot``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "k3m5o7q9s1u3"
down_revision: Union[str, None] = "j2l4n6p8r0t2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bot_mentions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mention_tweet_id", sa.String(length=25), nullable=False),
        sa.Column("author_handle", sa.String(length=50), nullable=False),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("events_created", sa.Integer(), nullable=False),
        sa.Column("reply_tweet_id", sa.String(length=25), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mention_tweet_id"),
    )


def downgrade() -> None:
    op.drop_table("bot_mentions")
