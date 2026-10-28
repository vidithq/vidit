"""store the order of an event's sources

Revision ID: b6d2f8a4c0e7
Revises: b7e2d9c4a1f6
Create Date: 2026-10-28 20:00:00.000000

``sources.position`` holds an event's source's place in its list, as the last write posted it.
Each event's sources take the place they read in until now: level, then capture time with
unknown last, then creation.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b6d2f8a4c0e7"
down_revision: Union[str, None] = "b7e2d9c4a1f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
    )
    op.execute(
        """
        UPDATE sources SET position = ranked.position
        FROM (
            SELECT id, row_number() OVER (
                PARTITION BY event_id
                ORDER BY
                    CASE level WHEN 'direct' THEN 0 WHEN 'indirect' THEN 1 ELSE 2 END,
                    captured_at ASC NULLS LAST,
                    created_at,
                    id
            ) - 1 AS position
            FROM sources
            WHERE event_id IS NOT NULL
        ) AS ranked
        WHERE sources.id = ranked.id
        """
    )


def downgrade() -> None:
    op.drop_column("sources", "position")
