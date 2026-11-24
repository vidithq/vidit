"""drop ix_events_owner_id

Revision ID: d5f7a9b1c3e6
Revises: c3e5a7b9d1f2
Create Date: 2026-11-24 10:00:00.000000

``ix_events_owner_created`` on ``(owner_id, created_at DESC)`` leads with ``owner_id``, so it
serves every lookup by owner the single-column index served.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5f7a9b1c3e6"
down_revision: Union[str, None] = "c3e5a7b9d1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_events_owner_id", table_name="events")


def downgrade() -> None:
    op.create_index("ix_events_owner_id", "events", ["owner_id"])
