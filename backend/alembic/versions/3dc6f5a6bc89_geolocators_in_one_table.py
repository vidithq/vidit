"""geolocators in one table

Revision ID: 3dc6f5a6bc89
Revises: 1194cd60dfe4
Create Date: 2026-10-24 11:10:00.000000

``event_geolocator_invites`` and ``event_geolocator_departures`` merge into
``event_geolocators``, one row per analyst and event with a ``state``:
``invited``, ``active`` or ``departed``, and the stamps ``invited_at``,
``joined_at`` and ``departed_at``.

- A credit row turns ``active``, ``joined_at`` its ``created_at``.
- A pending invitation turns ``invited``, ``invited_at`` its ``created_at``.
- A departure turns ``departed``, ``departed_at`` its ``created_at``. A former
  geolocator with a pending invitation, or credited again, keeps
  ``departed_at`` on the ``invited`` or ``active`` row.

The downgrade splits the rows back into the three tables.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3dc6f5a6bc89"
down_revision: Union[str, None] = "1194cd60dfe4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _pair_table(name: str) -> None:
    op.create_table(
        name,
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "user_id"),
    )


def upgrade() -> None:
    op.add_column("event_geolocators", sa.Column("state", sa.String(length=20), nullable=True))
    op.add_column(
        "event_geolocators", sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "event_geolocators", sa.Column("departed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.alter_column("event_geolocators", "created_at", new_column_name="joined_at")
    op.alter_column("event_geolocators", "joined_at", nullable=True)
    op.execute("UPDATE event_geolocators SET state = 'active'")
    op.execute(
        """
        INSERT INTO event_geolocators (event_id, user_id, state, invited_at)
        SELECT event_id, user_id, 'invited', created_at FROM event_geolocator_invites
        """
    )
    op.execute(
        """
        UPDATE event_geolocators g SET departed_at = d.created_at
        FROM event_geolocator_departures d
        WHERE g.event_id = d.event_id AND g.user_id = d.user_id
        """
    )
    op.execute(
        """
        INSERT INTO event_geolocators (event_id, user_id, state, departed_at)
        SELECT d.event_id, d.user_id, 'departed', d.created_at
        FROM event_geolocator_departures d
        WHERE NOT EXISTS (
            SELECT 1 FROM event_geolocators g
            WHERE g.event_id = d.event_id AND g.user_id = d.user_id
        )
        """
    )
    op.alter_column("event_geolocators", "state", nullable=False)
    op.create_check_constraint(
        "ck_event_geolocators_state_valid",
        "event_geolocators",
        "state IN ('invited', 'active', 'departed')",
    )
    op.create_check_constraint(
        "ck_event_geolocators_state_stamp",
        "event_geolocators",
        "(state <> 'invited' OR invited_at IS NOT NULL)"
        " AND (state <> 'active' OR joined_at IS NOT NULL)"
        " AND (state <> 'departed' OR departed_at IS NOT NULL)",
    )
    op.drop_index("ix_event_geolocators_user_created_at", table_name="event_geolocators")
    op.create_index(
        "ix_event_geolocators_user_id_joined_at",
        "event_geolocators",
        ["user_id", "joined_at"],
        postgresql_where=sa.text("state = 'active'"),
    )
    op.create_index("ix_event_geolocators_user_id", "event_geolocators", ["user_id"])
    op.drop_table("event_geolocator_invites")
    op.drop_table("event_geolocator_departures")


def downgrade() -> None:
    _pair_table("event_geolocator_invites")
    op.create_index(
        "ix_event_geolocator_invites_user_id", "event_geolocator_invites", ["user_id"]
    )
    _pair_table("event_geolocator_departures")
    op.create_index(
        "ix_event_geolocator_departures_user_id", "event_geolocator_departures", ["user_id"]
    )
    op.execute(
        """
        INSERT INTO event_geolocator_invites (event_id, user_id, created_at)
        SELECT event_id, user_id, invited_at FROM event_geolocators WHERE state = 'invited'
        """
    )
    op.execute(
        """
        INSERT INTO event_geolocator_departures (event_id, user_id, created_at)
        SELECT event_id, user_id, departed_at FROM event_geolocators
        WHERE departed_at IS NOT NULL
        """
    )
    op.execute("DELETE FROM event_geolocators WHERE state <> 'active'")
    op.drop_index("ix_event_geolocators_user_id", table_name="event_geolocators")
    op.drop_index("ix_event_geolocators_user_id_joined_at", table_name="event_geolocators")
    op.drop_constraint("ck_event_geolocators_state_stamp", "event_geolocators", type_="check")
    op.drop_constraint("ck_event_geolocators_state_valid", "event_geolocators", type_="check")
    op.alter_column("event_geolocators", "joined_at", nullable=False)
    op.alter_column("event_geolocators", "joined_at", new_column_name="created_at")
    op.drop_column("event_geolocators", "departed_at")
    op.drop_column("event_geolocators", "invited_at")
    op.drop_column("event_geolocators", "state")
    op.create_index(
        "ix_event_geolocators_user_created_at", "event_geolocators", ["user_id", "created_at"]
    )
