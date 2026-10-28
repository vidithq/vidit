"""add the trigram extension

Revision ID: 0df564d5f320
Revises: a8d4f2c6e1b3
Create Date: 2026-10-28 16:00:00.000000

``pg_trgm`` scores how close two words are. ``GET /search`` uses it to suggest the closest
spelling when a query finds nothing.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0df564d5f320"
down_revision: Union[str, None] = "a8d4f2c6e1b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
