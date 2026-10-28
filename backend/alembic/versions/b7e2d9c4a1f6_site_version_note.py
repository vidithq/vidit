"""add the version note to site versions

Revision ID: b7e2d9c4a1f6
Revises: 0df564d5f320
Create Date: 2026-10-28 18:00:00.000000

The owner's edit of a site takes the optional note an event version takes, filed on the version
it supersedes.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e2d9c4a1f6"
down_revision: Union[str, None] = "0df564d5f320"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("site_versions", sa.Column("note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("site_versions", "note")
