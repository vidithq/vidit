"""add event_approvals and the approval notification kinds

Revision ID: 081e5a75dc49
Revises: 337bd8368ac6
Create Date: 2026-10-15 14:00:00.000000

``event_approvals`` holds one review per analyst and version of an event. A
review is current while its version is the event's live version and it is not
revoked; nothing is written when a version ends it. Revocation stamps the row
with a public reason and keeps it. No backfill: no approval exists before this
table.

``ck_notifications_kind_valid`` widens to ``re_approve_requested`` and
``approval_received``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "081e5a75dc49"
down_revision: Union[str, None] = "337bd8368ac6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_BEFORE = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_admin_inherited')"
)
_KINDS_AFTER = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_admin_inherited', 're_approve_requested', 'approval_received')"
)


def upgrade() -> None:
    op.create_table(
        "event_approvals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.Uuid(), nullable=False),
        sa.Column(
            "verdict", sa.String(length=20), server_default=sa.text("'approve'"), nullable=False
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_id", sa.Uuid(), nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.CheckConstraint("verdict IN ('approve')", name="ck_event_approvals_verdict_valid"),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoke_reason IS NULL)",
            name="ck_event_approvals_revoke_reason",
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["revoked_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "event_id",
            "version_no",
            "reviewer_id",
            name="uq_event_approvals_event_version_reviewer",
        ),
    )
    op.create_index("ix_event_approvals_reviewer_id", "event_approvals", ["reviewer_id"])
    op.create_index(
        "ix_event_approvals_revoked_by_id",
        "event_approvals",
        ["revoked_by_id"],
        postgresql_where=sa.text("revoked_by_id IS NOT NULL"),
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_AFTER)


def downgrade() -> None:
    op.execute(
        "DELETE FROM notifications WHERE kind IN ('re_approve_requested', 'approval_received')"
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_BEFORE)
    op.drop_index("ix_event_approvals_revoked_by_id", table_name="event_approvals")
    op.drop_index("ix_event_approvals_reviewer_id", table_name="event_approvals")
    op.drop_table("event_approvals")
