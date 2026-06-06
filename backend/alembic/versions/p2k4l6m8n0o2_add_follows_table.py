"""add_follows_table

Revision ID: p2k4l6m8n0o2
Revises: o1j3k5l7m9n1
Create Date: 2026-05-12 15:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p2k4l6m8n0o2"
down_revision: Union[str, None] = "o1j3k5l7m9n1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ``(follower_id, followed_id)`` is the natural primary key — gives
    # uniqueness for free, no separate UNIQUE constraint needed.
    # ON DELETE CASCADE on both FKs so a hard-deleted user (admin path)
    # doesn't leave orphan edges.
    op.create_table(
        "follows",
        sa.Column("follower_id", sa.Uuid(), nullable=False),
        sa.Column("followed_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["followed_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["follower_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("follower_id", "followed_id"),
        # API rejects self-follow with a 400; the CHECK is the durable
        # DB-level invariant against a future code path that skips the
        # router-side check.
        sa.CheckConstraint(
            "follower_id <> followed_id", name="ck_follows_no_self_follow"
        ),
    )
    # The PK's leading edge indexes the forward direction (who is X
    # following?). The reverse direction (who follows X?) lands on
    # ``followed_id`` alone and would otherwise full-scan — that's the
    # exact query ``followers_count`` runs on every profile page load.
    op.create_index(
        "ix_follows_followed_id", "follows", ["followed_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_follows_followed_id", table_name="follows")
    op.drop_table("follows")
