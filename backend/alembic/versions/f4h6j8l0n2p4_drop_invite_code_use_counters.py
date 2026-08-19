"""drop invite_codes.max_uses + invite_codes.use_count

Revision ID: f4h6j8l0n2p4
Revises: e3g5i7k9m1o3
Create Date: 2026-08-19 10:00:00.000000

Every invite code is single-use. The mint path never accepted a quota, so
every row carries ``max_uses = 1`` and a ``use_count`` of 0 or 1, which makes
the pair a second encoding of ``used_at``: a code is redeemed exactly when
``used_at IS NOT NULL``. Validity now reads ``revoked_at IS NULL AND used_at
IS NULL AND (expires_at IS NULL OR expires_at > now())``, and redemption
claims the row with ``UPDATE ... WHERE used_at IS NULL RETURNING``, which
keeps the same single-winner guarantee under READ COMMITTED.

Downgrade re-adds both columns and rebuilds the counters from ``used_at``:
``max_uses = 1`` everywhere, ``use_count = 1`` on a redeemed row and 0
otherwise.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f4h6j8l0n2p4"
down_revision: Union[str, None] = "e3g5i7k9m1o3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("invite_codes", "use_count")
    op.drop_column("invite_codes", "max_uses")


def downgrade() -> None:
    op.add_column(
        "invite_codes",
        sa.Column("max_uses", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "invite_codes",
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute("UPDATE invite_codes SET use_count = 1 WHERE used_at IS NOT NULL")
