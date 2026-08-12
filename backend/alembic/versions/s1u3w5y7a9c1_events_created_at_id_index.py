"""events created_at id keyset index

Revision ID: s1u3w5y7a9c1
Revises: r0t2v4x6z8b0
Create Date: 2026-08-12 10:00:00.000000

The composite the capped list endpoints page on. ``/events``,
``/events/detections`` and ``/timeline`` order by ``created_at DESC, id DESC``
and cut each page with a row comparison over that pair
(``services/pagination.keyset_before``), which Postgres serves from an index on
the same two columns. Without it every page costs a sort of the matching set,
which is exactly the cost the cursor exists to avoid.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "s1u3w5y7a9c1"
down_revision: Union[str, None] = "r0t2v4x6z8b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_events_created_at_id", "events", ["created_at", "id"])


def downgrade() -> None:
    op.drop_index("ix_events_created_at_id", table_name="events")
