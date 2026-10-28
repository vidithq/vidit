"""fold accents in search

Revision ID: a8d4f2c6e1b3
Revises: 40774b404db1
Create Date: 2026-10-28 14:00:00.000000

The ``simple_unaccent`` text search configuration is ``simple`` with the ``unaccent``
dictionary in front, so ``cafe`` and ``café`` read as one word. The three search GIN
indexes are rebuilt on it; each expression must stay equal to its ``services/search``
counterpart, or Postgres falls back to a sequential scan.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8d4f2c6e1b3"
down_revision: Union[str, None] = "40774b404db1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES = {
    "ix_users_search_fts": (
        "users",
        "coalesce(username, '') || ' ' || coalesce(bio, '')",
    ),
    "ix_organizations_search_fts": (
        "organizations",
        "coalesce(name, '') || ' ' || coalesce(slug, '') || ' ' || coalesce(bio, '')",
    ),
    "ix_collections_search_fts": (
        "collections",
        "coalesce(title, '') || ' ' || coalesce(description_text, '')",
    ),
}


def _rebuild(config: str) -> None:
    for name, (table, document) in _INDEXES.items():
        op.drop_index(name, table_name=table)
        op.execute(f"CREATE INDEX {name} ON {table} USING GIN (to_tsvector('{config}', {document}))")


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute("CREATE TEXT SEARCH CONFIGURATION simple_unaccent (COPY = simple)")
    op.execute(
        "ALTER TEXT SEARCH CONFIGURATION simple_unaccent ALTER MAPPING FOR "
        "asciiword, asciihword, hword_asciipart, word, hword, hword_part WITH unaccent, simple"
    )
    _rebuild("simple_unaccent")


def downgrade() -> None:
    _rebuild("simple")
    op.execute("DROP TEXT SEARCH CONFIGURATION simple_unaccent")
    op.execute("DROP EXTENSION IF EXISTS unaccent")
