"""event version model

Revision ID: f4h6j8l0n2p4
Revises: e3g5i7k9m1o3
Create Date: 2026-08-18 10:00:00.000000

A published geolocation is corrected, not frozen, and a correction must not
silently rewrite the record. ``events.version_no`` says which version the live
row is (every existing row backfills to 1, the version it was published as), and
``event_versions`` holds the versions it superseded: one append-only row per
edit, carrying the editable fields as they stood plus who edited and when.

``version_no`` is unique per event, so the append-only writer cannot file two
rows for one version; the constraint's leading ``event_id`` also serves the only
read there is ("this event's history, by version"), so there is no secondary
index. ``edited_by`` is ``ON DELETE SET NULL``: an event outlives an editor who
is not its owner, and erasing that account must not fail on the FK.

Downgrade drops the table and the column, losing every superseded version; the
live rows keep the state they currently hold.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f4h6j8l0n2p4"
down_revision: Union[str, None] = "e3g5i7k9m1o3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOT NULL with a server default, so the backfill is the default itself:
    # every published row is version 1 and nothing has superseded it yet.
    op.add_column(
        "events",
        sa.Column("version_no", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.create_table(
        "event_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        # The version this row HOLDS, not the one that replaced it.
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("edited_by_id", sa.Uuid(), nullable=True),
        # Unbounded like the other free-text columns; the API caps accepted
        # input at the boundary.
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["edited_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "version_no", name="uq_event_versions_event_no"),
    )


def downgrade() -> None:
    op.drop_table("event_versions")
    op.drop_column("events", "version_no")
