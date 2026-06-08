"""user_token_version

Revision ID: t6o8q0s2u4w6
Revises: s5n7p9r1t3v5
Create Date: 2026-06-08 10:00:00.000000

Adds ``users.token_version INTEGER NOT NULL DEFAULT 0``.

The session JWT embeds this value as a ``tv`` claim at mint time and
``get_current_user`` 401s on mismatch. Bumping the column on logout,
password change, password reset, and soft-delete instantly invalidates
every outstanding session for the user — until now, clearing the
session cookie did not invalidate the underlying token, so a leaked
JWT (e.g. via an XSS sniff or a stolen device) stayed live to its
``exp``. This is the interim Tier-2 fix; the Tier-3 refresh-token
system planned for the open-beta milestone supersedes it.

NOT NULL DEFAULT 0 backfills cleanly under PostgreSQL 11+'s metadata-
only fast path (no full-table rewrite); existing tokens minted before
this migration carry no ``tv`` claim and so will 401 on the first
post-deploy request, which is the intended one-time forced logout.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "t6o8q0s2u4w6"
down_revision: Union[str, None] = "s5n7p9r1t3v5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "token_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "token_version")
