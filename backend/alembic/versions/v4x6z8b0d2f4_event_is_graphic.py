"""events.is_graphic

Revision ID: v4x6z8b0d2f4
Revises: u3w5y7a9c1e3
Create Date: 2026-08-12 10:00:00.000000

The author-set graphic-content flag: TRUE when the footage shows death,
injury or human remains. The write forms carry it, and the read surface
covers a flagged event's imagery until the viewer asks to see it.

No index: nothing filters on the column. It travels with the row every read
already fetches, and the covering decision is made per event, not per page.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v4x6z8b0d2f4"
down_revision: Union[str, None] = "u3w5y7a9c1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "is_graphic",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "is_graphic")
