"""add push_subscriptions.refusals

Revision ID: e8d74c4e51a4
Revises: 06f82ee71c5b
Create Date: 2026-10-16 09:10:00.000000

Counts the push service's refusals of a device since its last accepted push.
The sender drops a device at the third refusal in a row, as it drops one the
push service reports gone. Existing devices start at zero.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8d74c4e51a4"
down_revision: Union[str, None] = "06f82ee71c5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "push_subscriptions",
        sa.Column("refusals", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("push_subscriptions", "refusals")
