"""bounties.is_demo — demo flag mirroring geolocations.is_demo

Revision ID: m9h1c3d5e7f9
Revises: l8g0b2c4d6e8
Create Date: 2026-05-12 15:00:00.000000

Adds a boolean ``is_demo`` flag to the ``bounties`` table so the admin
"Demo bounties" panel can bulk-wipe synthetic rows the same way the
geolocation demo seeder does. Same partial-index pattern as
``geolocations.is_demo``: the wipe sweep runs ``WHERE is_demo = TRUE``
which would otherwise full-scan the table.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "m9h1c3d5e7f9"
down_revision: Union[str, None] = "l8g0b2c4d6e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bounties",
        sa.Column(
            "is_demo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_bounties_demo",
        "bounties",
        ["id"],
        postgresql_where=sa.text("is_demo = true"),
    )


def downgrade() -> None:
    op.drop_index("ix_bounties_demo", table_name="bounties")
    op.drop_column("bounties", "is_demo")
