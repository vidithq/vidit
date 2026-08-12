"""per-provider capture columns on source_archives

Revision ID: u3w5y7a9c1e3
Revises: t2v4x6z8b0d2
Create Date: 2026-08-12 14:00:00.000000

The Wayback Machine and archive.today become peers: every link is submitted to
both, and the row holds a capture column per provider instead of one
``archived_url`` plus the ``provider`` that produced it. The lifecycle stays
shared (one ``status``, one ``attempts``, one ``next_attempt_at``), because the
first capture to land ends the job for the link.

Existing rows map by their own ``provider``: a ``wayback`` row's
``archived_url`` becomes ``wayback_url``, an ``archive_today`` row's becomes
``archive_today_url``. A ``done`` row therefore keeps exactly one capture, which
still satisfies the new "at least one" check, and every other status keeps both
columns NULL. Statuses are untouched.

Downgrade folds the pair back into ``archived_url`` + ``provider``, preferring
the Wayback capture when a row somehow holds both (only a row written by the
new code can), so the single-column shape stays the primary-provider one the
old code reads.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "u3w5y7a9c1e3"
down_revision: Union[str, None] = "t2v4x6z8b0d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "source_archives"
_OLD_CHECK = "ck_source_archives_done_url"
_NEW_CHECK = "ck_source_archives_done_capture"


def split_captures_sql(table: str) -> tuple[str, ...]:
    """The statements that move ``archived_url`` into its provider's column.

    Table-parameterised so the data mapping is exercisable against a scratch
    table (``tests/test_source_archive.py``) rather than only by running the
    migration: a mapping that silently drops a capture would otherwise be
    unfalsifiable until production rows moved.
    """
    return (
        f"UPDATE {table} SET wayback_url = archived_url"
        f" WHERE archived_url IS NOT NULL AND provider = 'wayback'",
        f"UPDATE {table} SET archive_today_url = archived_url"
        f" WHERE archived_url IS NOT NULL AND provider = 'archive_today'",
        # A ``done`` row whose provider was never stamped would land with both
        # columns NULL and fail the new check. None should exist (the old code
        # wrote the pair together), so this is a repair rather than a rewrite of
        # history: the link goes back on the queue and is captured again.
        f"UPDATE {table} SET status = 'queued', finished_at = NULL,"
        f" next_attempt_at = now()"
        f" WHERE status = 'done' AND wayback_url IS NULL AND archive_today_url IS NULL",
    )


def merge_captures_sql(table: str) -> str:
    """The statement that folds the pair back into ``archived_url`` + ``provider``.

    Prefers the Wayback capture when a row holds both, so the single-column
    shape stays the primary-provider one the pre-upgrade code reads.
    """
    return (
        f"UPDATE {table}"
        f"   SET archived_url = COALESCE(wayback_url, archive_today_url),"
        f"       provider = CASE WHEN wayback_url IS NOT NULL"
        f"                       THEN 'wayback' ELSE 'archive_today' END"
        f" WHERE wayback_url IS NOT NULL OR archive_today_url IS NOT NULL"
    )


def upgrade() -> None:
    # The old check ties ``done`` to ``archived_url``, so it has to go before
    # the column it names does.
    op.drop_constraint(_OLD_CHECK, _TABLE, type_="check")
    op.add_column(_TABLE, sa.Column("wayback_url", sa.Text(), nullable=True))
    op.add_column(_TABLE, sa.Column("archive_today_url", sa.Text(), nullable=True))
    for statement in split_captures_sql(_TABLE):
        op.execute(statement)
    op.drop_column(_TABLE, "archived_url")
    op.drop_column(_TABLE, "provider")
    op.create_check_constraint(
        _NEW_CHECK,
        _TABLE,
        "(status = 'done'"
        " AND (wayback_url IS NOT NULL OR archive_today_url IS NOT NULL))"
        " OR (status <> 'done'"
        " AND wayback_url IS NULL AND archive_today_url IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(_NEW_CHECK, _TABLE, type_="check")
    op.add_column(_TABLE, sa.Column("archived_url", sa.Text(), nullable=True))
    op.add_column(_TABLE, sa.Column("provider", sa.String(length=20), nullable=True))
    op.execute(merge_captures_sql(_TABLE))
    op.drop_column(_TABLE, "wayback_url")
    op.drop_column(_TABLE, "archive_today_url")
    op.create_check_constraint(
        _OLD_CHECK,
        _TABLE,
        "(status = 'done' AND archived_url IS NOT NULL)"
        " OR (status <> 'done' AND archived_url IS NULL)",
    )
