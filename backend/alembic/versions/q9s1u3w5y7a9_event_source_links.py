"""secondary source links

Revision ID: q9s1u3w5y7a9
Revises: p8r0t2v4x6z8
Create Date: 2026-08-11 10:00:00.000000

An event's primary evidence anchor stays the scalar ``events.source_url`` (the
first place the media was posted). The same footage is usually mirrored on other
networks, and that set is a list, not a column: ``event_source_links`` holds it
as ordered child rows, ``position`` in the composite primary key so the stored
order is the read order and a duplicate slot is rejected by Postgres. The FK
cascades so a hard-deleted event drops its links.

Downgrade drops the table, losing every secondary link; the primary anchor in
``events.source_url`` is untouched.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q9s1u3w5y7a9"
down_revision: Union[str, None] = "p8r0t2v4x6z8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "event_source_links",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        # Unbounded like ``events.source_url``; the API caps accepted input at
        # the boundary rather than at flush time.
        sa.Column("url", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        # The reads are all "this event's links, in order", so the PK's leading
        # ``event_id`` is the only access path; no secondary index.
        sa.PrimaryKeyConstraint("event_id", "position"),
    )


def downgrade() -> None:
    op.drop_table("event_source_links")
