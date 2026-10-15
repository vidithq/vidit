"""add the organization full-text search index

Revision ID: c110dacdb047
Revises: e844dfeafd10
Create Date: 2026-10-15 22:00:00.000000

``ix_organizations_search_fts`` backs ``GET /search``'s organizations group.
The expression must stay equal to ``services/search._ORGANIZATION_TSVECTOR``,
or Postgres falls back to a sequential scan.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c110dacdb047"
down_revision: Union[str, None] = "e844dfeafd10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ORGANIZATION_TSVECTOR = (
    "to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(slug, '') || ' ' || coalesce(bio, ''))"
)


def upgrade() -> None:
    op.execute(
        f"CREATE INDEX ix_organizations_search_fts ON organizations "
        f"USING GIN ({_ORGANIZATION_TSVECTOR})"
    )


def downgrade() -> None:
    op.drop_index("ix_organizations_search_fts", table_name="organizations")
