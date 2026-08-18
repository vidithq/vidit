"""events.detected_thread_tweet_ids + events.detected_via

Revision ID: e3g5i7k9m1o3
Revises: d2f4h6j8l0n2
Create Date: 2026-08-18 10:00:00.000000

Two columns the three ingest entries need to agree.

``detected_thread_tweet_ids`` holds every post id of the thread a draft was read
from, the anchor included. The archive stitches a self-thread A→B→C whole and
anchors the draft on A, while a bot tag or a paste on C reads one hop and
anchors on B, so a match on the anchor alone filed one geolocation as two
drafts. The re-import matches on an overlap between the incoming thread's ids
and the stored ones, which holds in both directions. Existing rows are
backfilled with their anchor id alone, which is exactly what they were matched
on before.

``detected_via`` records which entry produced a draft (``bot`` / ``paste`` /
``archive``), stamped at creation. Existing rows stay NULL: the entry was never
recorded, and NULL says so rather than guessing one.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e3g5i7k9m1o3"
down_revision: Union[str, None] = "d2f4h6j8l0n2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_THREAD_INDEX = "ix_events_detected_thread_tweet_ids"
_VIA_CHECK = "ck_events_detected_via_valid"


def backfill_thread_ids_sql(table: str) -> str:
    """The statement that seeds each row's thread with its own anchor id.

    Table-parameterised so the data mapping runs against a scratch table in
    ``tests/test_ingest_migrations.py``: a row that came out with an empty
    array rather than NULL, or with a NULL element inside the array, would
    match nothing on the overlap leg and split one geolocation across two
    drafts.
    """
    return f"""
        UPDATE {table}
        SET detected_thread_tweet_ids = ARRAY[detected_from_tweet_id]
        WHERE detected_from_tweet_id IS NOT NULL
        """


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("detected_thread_tweet_ids", postgresql.ARRAY(sa.BigInteger()), nullable=True),
    )
    op.add_column("events", sa.Column("detected_via", sa.String(length=20), nullable=True))
    op.execute(backfill_thread_ids_sql("events"))
    op.create_index(
        _THREAD_INDEX,
        "events",
        ["detected_thread_tweet_ids"],
        postgresql_using="gin",
        postgresql_where=sa.text("detected_thread_tweet_ids IS NOT NULL"),
    )
    op.create_check_constraint(
        _VIA_CHECK,
        "events",
        "detected_via IS NULL OR detected_via IN ('bot', 'paste', 'archive')",
    )


def downgrade() -> None:
    op.drop_constraint(_VIA_CHECK, "events", type_="check")
    op.drop_index(_THREAD_INDEX, table_name="events")
    op.drop_column("events", "detected_via")
    op.drop_column("events", "detected_thread_tweet_ids")
