"""add revoked_push_endpoints

Revision ID: 38df4850a8bb
Revises: a2abb5b374d8
Create Date: 2026-10-16 13:00:00.000000

The SHA-256 of each push endpoint an analyst revoked, so a browser that still
holds the subscription cannot register it again by itself. Enabling push on that
browser clears the row. The endpoint itself is a bearer URL and is not kept.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "38df4850a8bb"
down_revision: Union[str, None] = "a2abb5b374d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "revoked_push_endpoints",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint_sha256", sa.String(length=64), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "endpoint_sha256"),
    )


def downgrade() -> None:
    op.drop_table("revoked_push_endpoints")
