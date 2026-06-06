"""users.is_demo + geolocations.is_demo

Revision ID: g3b5d7e9f1a3
Revises: f1a3b5c7d9e0
Create Date: 2026-05-09 19:00:00.000000

Demo flag for synthetic data created by the admin "Demo data" panel.
The seeder marks every row it creates with is_demo=True so the wipe
button can drop them in bulk without touching real analyst content.
Partial indexes on the rare (TRUE) cohort keep wipe queries cheap as
the demo set scales while not bloating index size for the common
case where everyone is_demo=FALSE.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "g3b5d7e9f1a3"
down_revision: Union[str, None] = "f1a3b5c7d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_demo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_users_demo",
        "users",
        ["id"],
        postgresql_where=sa.text("is_demo = true"),
    )

    op.add_column(
        "geolocations",
        sa.Column(
            "is_demo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_geolocations_demo",
        "geolocations",
        ["id"],
        postgresql_where=sa.text("is_demo = true"),
    )


def downgrade() -> None:
    op.drop_index("ix_geolocations_demo", table_name="geolocations")
    op.drop_column("geolocations", "is_demo")
    op.drop_index("ix_users_demo", table_name="users")
    op.drop_column("users", "is_demo")
