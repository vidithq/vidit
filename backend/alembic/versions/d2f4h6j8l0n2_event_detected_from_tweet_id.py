"""events.detected_from_tweet_id, the re-import match anchor

Revision ID: d2f4h6j8l0n2
Revises: c1e3g5i7k9m1
Create Date: 2026-08-17 10:00:00.000000

The post a machine detection came from is identified by its id, not by a
URL: one post spells the same URL several ways (``x.com`` or ``twitter.com``,
the handle in any case, the handle-less ``/i/web/status/`` form), and two
spellings of one post must not split one geolocation across two detections.

``detected_from_tweet_id`` holds that id and ``detected_from_url`` stays as the
display value. The backfill reads the id out of the URL already stored: every
value written so far is an X status URL, and a row whose URL yields no id keeps
a NULL id and dedups on its source URL alone.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d2f4h6j8l0n2"
down_revision: Union[str, None] = "c1e3g5i7k9m1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "ix_events_owner_detected_from_tweet_id"

# The status id inside a stored provenance URL: the digits after ``/status/``,
# ended by the path, a query, a fragment or the string. Capped at 19 digits, the
# width of a bigint, and compared as numeric below so a longer or larger value
# is left NULL rather than overflowing the column.
_STATUS_ID_RE = "/status/([0-9]{1,19})(?:[/?#]|$)"


def backfill_tweet_id_sql(table: str) -> str:
    """The statement that reads each stored provenance URL's status id.

    Table-parameterised so the data mapping runs against a scratch table in
    ``tests/test_ingest_migrations.py`` rather than only through
    ``alembic upgrade``: a pattern that misses ``twitter.com`` or the
    handle-less ``/i/web/status/`` form would otherwise leave those rows
    matching on their source URL alone, unfalsifiably until production rows
    moved.
    """
    return f"""
        UPDATE {table} AS e
        SET detected_from_tweet_id = parsed.tweet_id::bigint
        FROM (
            SELECT id, substring(detected_from_url from '{_STATUS_ID_RE}') AS tweet_id
            FROM {table}
            WHERE detected_from_url IS NOT NULL
        ) AS parsed
        WHERE e.id = parsed.id
          AND parsed.tweet_id IS NOT NULL
          AND parsed.tweet_id::numeric <= 9223372036854775807
        """


def upgrade() -> None:
    op.add_column("events", sa.Column("detected_from_tweet_id", sa.BigInteger(), nullable=True))
    op.execute(backfill_tweet_id_sql("events"))
    op.create_index(
        _INDEX,
        "events",
        ["owner_id", "detected_from_tweet_id"],
        postgresql_where=sa.text("detected_from_tweet_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX, table_name="events")
    op.drop_column("events", "detected_from_tweet_id")
