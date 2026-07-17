"""invite code x_handle

Revision ID: m5o7q9s1u3w5
Revises: l4n6p8r0t2v4
Create Date: 2026-07-17 12:00:00.000000

Invite codes can bind an X handle at mint time: redemption copies it onto
the new account's ``users.x_handle`` (the bot-attribution anchor), fail-soft
if the handle was taken meanwhile. Nullable, no index: read only by the
redemption path, one row at a time through the code's UNIQUE lookup.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "m5o7q9s1u3w5"
down_revision: Union[str, None] = "l4n6p8r0t2v4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("invite_codes", sa.Column("x_handle", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("invite_codes", "x_handle")
