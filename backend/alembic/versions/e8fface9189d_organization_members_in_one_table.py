"""organization members in one table

Revision ID: e8fface9189d
Revises: 3dc6f5a6bc89
Create Date: 2026-10-24 11:20:00.000000

``organization_invites`` merges into ``organization_members``, one row per
analyst and organization with a ``state``: ``invited`` or ``active``. A
membership turns ``active`` and keeps its role and ``joined_at``. A pending
invitation turns ``invited`` with ``role`` ``member``, its inviter as
``invited_by_id`` and its ``created_at`` as ``invited_at``. An invitation is
named by its organization and invitee, so the invitation ids go.

The downgrade moves the ``invited`` rows back to ``organization_invites`` with
fresh ids.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8fface9189d"
down_revision: Union[str, None] = "3dc6f5a6bc89"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organization_members", sa.Column("invited_by_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "organization_members_invited_by_id_fkey",
        "organization_members",
        "users",
        ["invited_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "organization_members",
        sa.Column("state", sa.String(length=20), nullable=False, server_default="active"),
    )
    op.alter_column("organization_members", "state", server_default=None)
    op.add_column(
        "organization_members",
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("organization_members", "joined_at", nullable=True)
    op.execute(
        """
        INSERT INTO organization_members
            (organization_id, user_id, invited_by_id, state, role, invited_at)
        SELECT organization_id, user_id, invited_by_id, 'invited', 'member', created_at
        FROM organization_invites
        ON CONFLICT (organization_id, user_id) DO NOTHING
        """
    )
    op.create_check_constraint(
        "ck_organization_members_state_valid",
        "organization_members",
        "state IN ('invited', 'active')",
    )
    op.create_check_constraint(
        "ck_organization_members_state_stamp",
        "organization_members",
        "(state <> 'invited' OR invited_at IS NOT NULL)"
        " AND (state <> 'active' OR joined_at IS NOT NULL)",
    )
    op.drop_table("organization_invites")


def downgrade() -> None:
    op.create_table(
        "organization_invites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("invited_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["invited_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_organization_invites_pair"),
    )
    op.create_index("ix_organization_invites_user_id", "organization_invites", ["user_id"])
    op.execute(
        """
        INSERT INTO organization_invites (id, organization_id, user_id, invited_by_id, created_at)
        SELECT gen_random_uuid(), organization_id, user_id, invited_by_id, invited_at
        FROM organization_members WHERE state = 'invited'
        """
    )
    op.execute("DELETE FROM organization_members WHERE state = 'invited'")
    op.drop_constraint(
        "ck_organization_members_state_stamp", "organization_members", type_="check"
    )
    op.drop_constraint(
        "ck_organization_members_state_valid", "organization_members", type_="check"
    )
    op.alter_column("organization_members", "joined_at", nullable=False)
    op.drop_column("organization_members", "invited_at")
    op.drop_column("organization_members", "state")
    op.drop_constraint(
        "organization_members_invited_by_id_fkey", "organization_members", type_="foreignkey"
    )
    op.drop_column("organization_members", "invited_by_id")
