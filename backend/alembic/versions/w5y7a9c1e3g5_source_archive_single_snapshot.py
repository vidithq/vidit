"""one analyst-recorded snapshot per link on source_archives

Revision ID: w5y7a9c1e3g5
Revises: v4x6z8b0d2f4
Create Date: 2026-08-13 10:00:00.000000

The table stops being a capture queue and becomes a record of the copies
analysts made. The automatic pipeline is gone, so every column that served it
goes with it: ``status``, ``attempts``, ``error``, ``next_attempt_at``,
``started_at``, ``finished_at``, and the two per-provider capture columns.
What is left is one link, one snapshot, and the provider that holds it.

Existing captures move across: a row holding ``wayback_url`` or
``archive_today_url`` keeps that URL as ``snapshot_url``, with ``provider``
stamped from whichever column it came out of. Wayback wins when a row holds
both, since a replay URL embeds the original it captured and an archive.today
short code does not.

Rows with no capture are deleted. They were queue entries: an unfinished job
under a pipeline that no longer runs, and nothing under the new model, where a
row exists because a copy exists.

Downgrade restores the old columns nullable and maps ``snapshot_url`` back to
its provider's column, with ``status`` set to ``done`` (the row does hold a
capture) so the restored ``ck_source_archives_done_capture`` is satisfied. It
does not resurrect the deleted queue rows: a link with no copy carries no row,
and the pre-downgrade backfill is what would have re-queued it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w5y7a9c1e3g5"
down_revision: Union[str, None] = "v4x6z8b0d2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "source_archives"
_DONE_CHECK = "ck_source_archives_done_capture"
_STATUS_CHECK = "ck_source_archives_status_valid"
_PROVIDER_CHECK = "ck_source_archives_provider_valid"
_CLAIM_INDEX = "ix_source_archives_status_next_attempt"

# The queue machinery, dropped on upgrade and restored on downgrade.
_QUEUE_COLUMNS = (
    "status",
    "wayback_url",
    "archive_today_url",
    "attempts",
    "error",
    "next_attempt_at",
    "started_at",
    "finished_at",
)


def fold_captures_sql(table: str) -> tuple[str, ...]:
    """The statements that fold the two capture columns into one snapshot.

    Table-parameterised so the data mapping is exercisable against a scratch
    table (``tests/test_source_archive.py``) rather than only by running the
    migration: a mapping that silently drops a capture, or one that keeps a
    queue row with nothing in it, would otherwise be unfalsifiable until
    production rows moved.
    """
    return (
        f"UPDATE {table}"
        f"   SET snapshot_url = COALESCE(wayback_url, archive_today_url),"
        f"       provider = CASE WHEN wayback_url IS NOT NULL"
        f"                       THEN 'wayback' ELSE 'archive_today' END"
        f" WHERE wayback_url IS NOT NULL OR archive_today_url IS NOT NULL",
        f"DELETE FROM {table}"
        f" WHERE wayback_url IS NULL AND archive_today_url IS NULL",
    )


def unfold_captures_sql(table: str) -> str:
    """The statement that puts one snapshot back in its provider's column.

    ``status`` goes to ``done`` with it: every surviving row holds a capture,
    which is exactly what the restored ``ck_source_archives_done_capture``
    pins.
    """
    return (
        f"UPDATE {table}"
        f"   SET wayback_url = CASE WHEN provider = 'wayback' THEN snapshot_url END,"
        f"       archive_today_url = CASE WHEN provider = 'archive_today'"
        f"                                THEN snapshot_url END,"
        f"       status = 'done',"
        f"       finished_at = created_at"
    )


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("snapshot_url", sa.Text(), nullable=True))
    op.add_column(_TABLE, sa.Column("provider", sa.String(length=20), nullable=True))
    for statement in fold_captures_sql(_TABLE):
        op.execute(statement)
    # Both checks name columns that are about to go, so they come off first
    # rather than relying on the cascade a DROP COLUMN happens to perform.
    op.drop_constraint(_DONE_CHECK, _TABLE, type_="check")
    op.drop_constraint(_STATUS_CHECK, _TABLE, type_="check")
    op.drop_index(_CLAIM_INDEX, table_name=_TABLE)
    for column in _QUEUE_COLUMNS:
        op.drop_column(_TABLE, column)
    # NOT NULL only after the fold and the delete: every remaining row now
    # carries both values.
    op.alter_column(_TABLE, "snapshot_url", nullable=False)
    op.alter_column(_TABLE, "provider", nullable=False)
    op.create_check_constraint(
        _PROVIDER_CHECK, _TABLE, "provider IN ('wayback', 'archive_today')"
    )


def downgrade() -> None:
    op.drop_constraint(_PROVIDER_CHECK, _TABLE, type_="check")
    op.add_column(_TABLE, sa.Column("status", sa.String(length=10), nullable=True))
    op.add_column(_TABLE, sa.Column("wayback_url", sa.Text(), nullable=True))
    op.add_column(_TABLE, sa.Column("archive_today_url", sa.Text(), nullable=True))
    op.add_column(_TABLE, sa.Column("attempts", sa.Integer(), nullable=True))
    op.add_column(_TABLE, sa.Column("error", sa.Text(), nullable=True))
    op.add_column(_TABLE, sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(_TABLE, sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(_TABLE, sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(unfold_captures_sql(_TABLE))
    op.execute(f"UPDATE {_TABLE} SET attempts = 1, next_attempt_at = created_at")
    op.drop_column(_TABLE, "snapshot_url")
    op.drop_column(_TABLE, "provider")
    op.alter_column(_TABLE, "status", nullable=False)
    op.alter_column(_TABLE, "attempts", nullable=False, server_default="0")
    op.alter_column(_TABLE, "next_attempt_at", nullable=False)
    op.create_index(_CLAIM_INDEX, _TABLE, ["status", "next_attempt_at"])
    op.create_check_constraint(
        _STATUS_CHECK, _TABLE, "status IN ('queued', 'running', 'done', 'failed')"
    )
    op.create_check_constraint(
        _DONE_CHECK,
        _TABLE,
        "(status = 'done'"
        " AND (wayback_url IS NOT NULL OR archive_today_url IS NOT NULL))"
        " OR (status <> 'done'"
        " AND wayback_url IS NULL AND archive_today_url IS NULL)",
    )
