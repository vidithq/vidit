"""content_reports.event_id survives an event hard-delete

Revision ID: x6z8b0d2f4h6
Revises: w5y7a9c1e3g5
Create Date: 2026-08-13 09:00:00.000000

The report is the record that a complaint was filed and how it was answered,
so a hard-deleted event must not take it with it. ``event_id`` becomes nullable
and its foreign key switches from ``ON DELETE CASCADE`` to ``ON DELETE SET
NULL``: the event goes, the report and its verdict stay, pointing at nothing.

Postgres has no ALTER for a constraint's referential action, so the key is
dropped and recreated. The column is widened to nullable first, which is what
lets the new action write NULL into it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "x6z8b0d2f4h6"
down_revision: Union[str, None] = "w5y7a9c1e3g5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Alembic named the key when it created the table; Postgres derives the same
# name for both directions of this migration.
FK_NAME = "content_reports_event_id_fkey"


def upgrade() -> None:
    op.alter_column(
        "content_reports",
        "event_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.drop_constraint(FK_NAME, "content_reports", type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "content_reports",
        "events",
        ["event_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    """Restore the cascade, deleting orphaned reports first.

    A NOT NULL column cannot hold the rows whose event is already gone, and
    there is no event to re-attach them to, so the downgrade drops every report
    with a NULL ``event_id``. That loses the record of those complaints, which
    is the whole reason the upgrade exists: run it only on a database that has
    not orphaned any report yet, or accept the loss.
    """
    op.execute(sa.text("DELETE FROM content_reports WHERE event_id IS NULL"))
    op.drop_constraint(FK_NAME, "content_reports", type_="foreignkey")
    op.create_foreign_key(
        FK_NAME,
        "content_reports",
        "events",
        ["event_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.alter_column(
        "content_reports",
        "event_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
