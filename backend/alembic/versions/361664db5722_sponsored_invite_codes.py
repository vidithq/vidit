"""sponsored invite codes

Revision ID: 361664db5722
Revises: 08816f528cbf
Create Date: 2026-10-18 10:00:00.000000

``invite_codes.created_by`` names the analyst who minted a code from Settings,
NULL for an admin-minted code. ``ON DELETE SET NULL`` keeps the row as the
redeemer's origin record when the sponsor is erased. The index on
``(created_by, created_at)`` serves the daily quota count and the sponsor's own
list.

``users.invite_minting_enabled`` is the admin switch that turns minting off
for one analyst. Existing rows default to ``true``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "361664db5722"
down_revision: Union[str, None] = "08816f528cbf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK = "invite_codes_created_by_fkey"
_INDEX = "ix_invite_codes_created_by_created_at"


def upgrade() -> None:
    op.add_column("invite_codes", sa.Column("created_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        _FK, "invite_codes", "users", ["created_by"], ["id"], ondelete="SET NULL"
    )
    op.create_index(_INDEX, "invite_codes", ["created_by", "created_at"])
    op.add_column(
        "users",
        sa.Column(
            "invite_minting_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "invite_minting_enabled")
    op.drop_index(_INDEX, table_name="invite_codes")
    op.drop_constraint(_FK, "invite_codes", type_="foreignkey")
    op.drop_column("invite_codes", "created_by")
