"""one bot table

Revision ID: 4c85d28351c8
Revises: 7b0a79ff519a
Create Date: 2026-10-24 12:00:00.000000

``bot_webhook_events`` merges into ``bot_mentions``, which becomes both the
queue the worker drains and the ledger it leaves: ``payload``, ``status``
(``queued, running, done, failed``), ``attempt_count`` and ``created_at`` join
it, ``outcome`` is set exactly when ``done``, and ``processed_at`` is the
worker's latest claim or finish. Every ledger row is ``done``, its
``created_at`` its ``processed_at``.

A pending queue row (``queued`` or ``running``) becomes a ``queued`` mention
unless its post is already in the ledger. Processed and failed queue rows are
dropped.

The downgrade moves the ``queued`` and ``running`` mentions back to
``bot_webhook_events`` and drops the rest of the queue state.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "4c85d28351c8"
down_revision: Union[str, None] = "7b0a79ff519a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bot_mentions", sa.Column("payload", postgresql.JSONB(), nullable=True))
    op.add_column(
        "bot_mentions",
        sa.Column("status", sa.String(length=10), nullable=False, server_default="done"),
    )
    op.alter_column("bot_mentions", "status", server_default=None)
    op.add_column(
        "bot_mentions",
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("bot_mentions", "attempt_count", server_default=None)
    op.add_column("bot_mentions", sa.Column("created_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE bot_mentions SET created_at = processed_at")
    op.alter_column("bot_mentions", "created_at", nullable=False)
    op.alter_column("bot_mentions", "outcome", nullable=True)
    op.alter_column("bot_mentions", "processed_at", nullable=True)

    op.execute(
        """
        INSERT INTO bot_mentions
            (id, mention_post_id, author_x_handle, payload, status, attempt_count,
             created_event_count, created_at)
        SELECT id, (payload ->> 'tweet_id')::bigint, lower(payload ->> 'author_handle'),
               payload, 'queued', attempt_count, 0, created_at
        FROM bot_webhook_events
        WHERE status IN ('queued', 'running')
          AND payload ->> 'tweet_id' ~ '^[0-9]+$'
          AND payload ->> 'author_handle' IS NOT NULL
        ON CONFLICT (mention_post_id) DO NOTHING
        """
    )
    op.drop_index("ix_bot_webhook_events_status_created_at", table_name="bot_webhook_events")
    op.drop_table("bot_webhook_events")

    op.create_check_constraint(
        "ck_bot_mentions_status_valid",
        "bot_mentions",
        "status IN ('queued', 'running', 'done', 'failed')",
    )
    op.drop_constraint("ck_bot_mentions_outcome_valid", "bot_mentions", type_="check")
    op.create_check_constraint(
        "ck_bot_mentions_outcome_valid",
        "bot_mentions",
        "outcome IS NULL OR outcome IN ('created', 'updated', 'requested', 'inherited', "
        "'no_detection', 'no_account', 'skipped', 'self', 'failed')",
    )
    op.create_check_constraint(
        "ck_bot_mentions_outcome_done",
        "bot_mentions",
        "(status = 'done') = (outcome IS NOT NULL)",
    )
    op.create_index(
        "ix_bot_mentions_claim",
        "bot_mentions",
        ["created_at"],
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )


def downgrade() -> None:
    op.create_table(
        "bot_webhook_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bot_webhook_events_status_created_at",
        "bot_webhook_events",
        ["status", "created_at"],
    )
    op.execute(
        """
        INSERT INTO bot_webhook_events (id, payload, status, attempt_count, created_at)
        SELECT id, payload, 'queued', attempt_count, created_at
        FROM bot_mentions
        WHERE status IN ('queued', 'running') AND payload IS NOT NULL
        """
    )
    op.execute("DELETE FROM bot_mentions WHERE status <> 'done'")

    op.drop_index("ix_bot_mentions_claim", table_name="bot_mentions")
    op.drop_constraint("ck_bot_mentions_outcome_done", "bot_mentions", type_="check")
    op.drop_constraint("ck_bot_mentions_outcome_valid", "bot_mentions", type_="check")
    op.create_check_constraint(
        "ck_bot_mentions_outcome_valid",
        "bot_mentions",
        "outcome IN ('created', 'updated', 'requested', 'inherited', 'no_detection', "
        "'no_account', 'skipped', 'self', 'failed')",
    )
    op.drop_constraint("ck_bot_mentions_status_valid", "bot_mentions", type_="check")
    op.alter_column("bot_mentions", "processed_at", nullable=False)
    op.alter_column("bot_mentions", "outcome", nullable=False)
    op.drop_column("bot_mentions", "created_at")
    op.drop_column("bot_mentions", "attempt_count")
    op.drop_column("bot_mentions", "status")
    op.drop_column("bot_mentions", "payload")
