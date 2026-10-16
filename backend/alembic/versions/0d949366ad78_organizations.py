"""add organizations, organization_members, organization_invites

Revision ID: 0d949366ad78
Revises: 86adb4a35f3c
Create Date: 2026-10-15 10:00:00.000000

``organizations`` holds one public profile per collective. Only a site admin
creates a row, so ``slug`` and ``x_handle`` are unique and never self-serve.

``organization_members`` keys one role per analyst and organization on the
pair. ``ck_organization_members_role_valid`` pins the role to ``admin`` or
``member``.

``organization_invites`` holds pending invitations only: accepting turns the
row into a membership and declining deletes it. One pending invite per pair.

``notifications.organization_id`` names the organization an invite
notification is about, and two kinds join ``ck_notifications_kind_valid``.
Every new foreign key to ``organizations`` and to the invitee cascades.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0d949366ad78"
down_revision: Union[str, None] = "86adb4a35f3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_BEFORE = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred')"
)
_KINDS_AFTER = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted')"
)


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("x_handle", sa.String(length=50), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column(
            "external_links",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
        sa.UniqueConstraint("x_handle"),
    )

    op.create_table(
        "organization_members",
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "role IN ('admin', 'member')", name="ck_organization_members_role_valid"
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("organization_id", "user_id"),
    )
    op.create_index("ix_organization_members_user_id", "organization_members", ["user_id"])

    op.create_table(
        "organization_invites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("invited_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_organization_invites_pair"),
    )
    op.create_index("ix_organization_invites_user_id", "organization_invites", ["user_id"])

    op.add_column("notifications", sa.Column("organization_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "notifications_organization_id_fkey",
        "notifications",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_notifications_organization_id", "notifications", ["organization_id"])
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_AFTER)


def downgrade() -> None:
    op.execute(
        "DELETE FROM notifications WHERE kind IN "
        "('organization_invite', 'organization_invite_accepted')"
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_BEFORE)
    op.drop_index("ix_notifications_organization_id", table_name="notifications")
    op.drop_constraint("notifications_organization_id_fkey", "notifications", type_="foreignkey")
    op.drop_column("notifications", "organization_id")
    op.drop_index("ix_organization_invites_user_id", table_name="organization_invites")
    op.drop_table("organization_invites")
    op.drop_index("ix_organization_members_user_id", table_name="organization_members")
    op.drop_table("organization_members")
    op.drop_table("organizations")
