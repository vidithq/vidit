"""bot mention liked_at

Revision ID: o7q9s1u3w5y7
Revises: n6p8r0t2v4x6
Create Date: 2026-07-18 12:00:00.000000

Stamp the bot's like ack on the ledger row, so the gesture budget can count
likes over a wall-clock window the same way it counts replies via
``reply_tweet_id``. See ``services/bot.GestureBudget.from_ledger``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o7q9s1u3w5y7"
down_revision: Union[str, None] = "n6p8r0t2v4x6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bot_mentions", sa.Column("liked_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("bot_mentions", "liked_at")
