"""geolocation state: rename ``validated`` → ``human``

Revision ID: a3c5e7g9i1k3
Revises: z2b4d6f8h0j2
Create Date: 2026-06-27 14:30:00.000000

The non-machine lifecycle state is renamed ``validated`` → ``human``: it means
a person submitted or vouched for the row, not that it's independently verified.
``detected`` (the machine path) is unchanged. The ``validate`` action (the owner
vouching for a detection) keeps its name; it now produces ``human``.

Data migration on the existing rows + the column ``server_default``. Reversible.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a3c5e7g9i1k3"
down_revision: Union[str, None] = "z2b4d6f8h0j2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE geolocations SET state = 'human' WHERE state = 'validated'")
    op.alter_column("geolocations", "state", server_default="human")


def downgrade() -> None:
    op.alter_column("geolocations", "state", server_default="validated")
    op.execute("UPDATE geolocations SET state = 'validated' WHERE state = 'human'")
