"""geolocation: rename column ``state`` → ``status``

Revision ID: c5e7g9i1k3m5
Revises: b4d6f8h0j2l4
Create Date: 2026-06-28 09:00:00.000000

Unify the geolocation lifecycle column with ``bounties.status``: the same field
name, the same "Status" label, and the same badge concept across both entities
(the model already noted it mirrors ``bounties.status``). Values are unchanged
(``submitted`` / ``detected``); this is a pure column rename, so the data and
the ``server_default`` carry over untouched. Reversible.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "c5e7g9i1k3m5"
down_revision: Union[str, None] = "b4d6f8h0j2l4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("geolocations", "state", new_column_name="status")


def downgrade() -> None:
    op.alter_column("geolocations", "status", new_column_name="state")
