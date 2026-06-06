"""search FTS GIN indexes on geolocations / bounties / users

Revision ID: o1j3k5l7m9n1
Revises: n0i2d4e6f8a0
Create Date: 2026-05-12 21:30:00.000000

Three GIN indexes back the slice-1 ``GET /search`` endpoint:

- ``geolocations`` over ``coalesce(title, '')``
- ``bounties`` over ``coalesce(title, '')``
- ``users`` over ``coalesce(username, '') || ' ' || coalesce(bio, '')``

``'simple'`` (rather than ``'english'``) because the searchable corpus
is heavy on analyst handles, place names, conflict tags, and OSINT
identifiers that don't stem cleanly under any natural-language config.
``'simple'`` also keeps the matching behaviour predictable for the
closed beta — "Donetsk" matches "Donetsk" and not "donetsks", which is
what an analyst typing a query expects. Migrating to ``'english'``
later is one DDL away if usage proves the stemmer would help.

**Source URL not indexed.** Postgres' simple parser tokenizes a URL as
``host``-and-``path`` units, so an analyst searching for a path
fragment from a tweet URL wouldn't match anyway (the path lives inside
a single ``/foo/bar/baz`` token). The result cards still render the
source link verbatim — discovery via URL fragment is a slice-2 concern,
likely solved by normalising the URL into a domain-and-id pair on
write.

JSONB content (``geolocations.proof``, ``bounties.description``) isn't
indexed in this slice either — they need a flattening step before FTS
and the first slice doesn't need them. Same for
``users.trust_reason``: short admin notes that aren't worth indexing
yet.

Soft-deleted rows are filtered at query time (the endpoint adds
``WHERE deleted_at IS NULL`` to every branch); we keep them in the
index so the partial-index ``WHERE`` clause stays cheap and the
admin path can still search them via a flag in a later slice.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o1j3k5l7m9n1"
down_revision: Union[str, None] = "n0i2d4e6f8a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Reused across the three indexes so the expression stays consistent
# between the migration, the runtime query, and any future debugging
# (``EXPLAIN`` will refuse the index if the SELECT expression doesn't
# match the indexed expression byte-for-byte).
_GEO_TSVECTOR = "to_tsvector('simple', coalesce(title, ''))"
_BOUNTY_TSVECTOR = _GEO_TSVECTOR  # same column on a different table
_USER_TSVECTOR = (
    "to_tsvector('simple', "
    "coalesce(username, '') || ' ' || coalesce(bio, ''))"
)


def upgrade() -> None:
    op.execute(
        sa.text(
            "CREATE INDEX ix_geolocations_search_fts "
            f"ON geolocations USING GIN ({_GEO_TSVECTOR})"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX ix_bounties_search_fts "
            f"ON bounties USING GIN ({_BOUNTY_TSVECTOR})"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX ix_users_search_fts "
            f"ON users USING GIN ({_USER_TSVECTOR})"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_users_search_fts"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_bounties_search_fts"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_geolocations_search_fts"))
