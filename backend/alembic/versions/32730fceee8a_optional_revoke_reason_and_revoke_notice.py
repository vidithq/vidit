"""optional revoke reason, approval_revoked and notifications.approval_id

Revision ID: 32730fceee8a
Revises: 05d8a0952992
Create Date: 2026-10-17 10:00:00.000000

- ``ck_event_approvals_revoke_reason`` lets ``revoked_at`` be set with a null
  ``revoke_reason``; a reason still needs ``revoked_at``.
- The notification kind ``approval_revoked`` joins ``ck_notifications_kind_valid``.
- ``notifications.approval_id`` points an ``approval_received`` row at its
  approval, so the feed hides the row once the approval is revoked.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "32730fceee8a"
down_revision: Union[str, None] = "05d8a0952992"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_BEFORE = (
    "'request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_manager_inherited', 're_approve_requested', 'approval_received', "
)
_KINDS_AFTER = (
    "'approval_request_received', 'approval_request_declined', 'organization_approval_removed'"
)


def _kinds(*extra: str) -> str:
    return "kind IN (" + _KINDS_BEFORE + "".join(f"'{k}', " for k in extra) + _KINDS_AFTER + ")"


def upgrade() -> None:
    op.drop_constraint("ck_event_approvals_revoke_reason", "event_approvals", type_="check")
    op.create_check_constraint(
        "ck_event_approvals_revoke_reason",
        "event_approvals",
        "revoke_reason IS NULL OR revoked_at IS NOT NULL",
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_kind_valid", "notifications", _kinds("approval_revoked")
    )
    op.add_column(
        "notifications",
        sa.Column(
            "approval_id",
            sa.Uuid(),
            sa.ForeignKey("event_approvals.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_notifications_approval_id",
        "notifications",
        ["approval_id"],
        postgresql_where=sa.text("approval_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_approval_id", table_name="notifications")
    op.drop_column("notifications", "approval_id")
    op.execute("DELETE FROM notifications WHERE kind = 'approval_revoked'")
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _kinds())
    op.execute(
        "UPDATE event_approvals SET revoke_reason = 'No reason given' "
        "WHERE revoked_at IS NOT NULL AND revoke_reason IS NULL"
    )
    op.drop_constraint("ck_event_approvals_revoke_reason", "event_approvals", type_="check")
    op.create_check_constraint(
        "ck_event_approvals_revoke_reason",
        "event_approvals",
        "(revoked_at IS NULL) = (revoke_reason IS NULL)",
    )
