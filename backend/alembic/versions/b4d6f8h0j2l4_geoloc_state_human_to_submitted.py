"""geolocation state: rename ``human`` → ``submitted``

Revision ID: b4d6f8h0j2l4
Revises: a3c5e7g9i1k3
Create Date: 2026-06-27 16:00:00.000000

The non-machine lifecycle state is renamed ``human`` → ``submitted``: it reads
as a true status, parallel to ``detected`` (both past participles) instead of an
agent noun, and it still makes no verification claim. ``submitted`` means a
person submitted the row (via the form, or by submitting a reviewed detection).
``detected`` (the machine path) is unchanged.

Data migration on the existing rows + the column ``server_default``. Reversible.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "b4d6f8h0j2l4"
down_revision: Union[str, None] = "a3c5e7g9i1k3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE geolocations SET state = 'submitted' WHERE state = 'human'")
    op.alter_column("geolocations", "state", server_default="submitted")


def downgrade() -> None:
    op.alter_column("geolocations", "state", server_default="human")
    op.execute("UPDATE geolocations SET state = 'human' WHERE state = 'submitted'")
