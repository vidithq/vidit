"""drop the event and source title search indexes

Revision ID: 40774b404db1
Revises: 7c3e9a1f5d20
Create Date: 2026-10-28 12:00:00.000000

``GET /search`` matches an event on one document, its title and its sources' titles
together, so neither single-column GIN index serves a lookup.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "40774b404db1"
down_revision: Union[str, None] = "7c3e9a1f5d20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TITLE_TSVECTOR = "to_tsvector('simple', coalesce(title, ''))"


def upgrade() -> None:
    op.drop_index("ix_events_search_fts", table_name="events")
    op.drop_index("ix_sources_search_fts", table_name="sources")


def downgrade() -> None:
    op.execute(f"CREATE INDEX ix_events_search_fts ON events USING GIN ({_TITLE_TSVECTOR})")
    op.execute(f"CREATE INDEX ix_sources_search_fts ON sources USING GIN ({_TITLE_TSVECTOR})")
