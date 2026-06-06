"""unique fulfillment: one geolocation per bounty

Revision ID: n0i2d4e6f8a0
Revises: m9h1c3d5e7f9
Create Date: 2026-05-12 21:00:00.000000

Belt-and-suspenders guarantee that a bounty can be fulfilled at most
once. The router takes a row lock (``SELECT ... FOR UPDATE``) on the
bounty and gates the insert on ``status == 'open'``, but a partial
unique index makes the property a database-enforced invariant: even if
a future code path forgets the lock, the second insert fails on
constraint violation instead of silently doubling up.

Partial — ``WHERE originated_from_bounty_id IS NOT NULL`` — so the
unique constraint only applies to fulfilled-from-bounty geolocations.
Standalone geolocations (the dominant case) keep ``NULL`` and never
collide.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n0i2d4e6f8a0"
down_revision: Union[str, None] = "m9h1c3d5e7f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_geolocations_originated_from_bounty_id",
        "geolocations",
        ["originated_from_bounty_id"],
        unique=True,
        postgresql_where=sa.text("originated_from_bounty_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_geolocations_originated_from_bounty_id",
        table_name="geolocations",
    )
