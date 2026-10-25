"""remove x handle requests

Revision ID: e15b788dcaf0
Revises: 6a3943ca4316
Create Date: 2026-10-24 09:10:00.000000

An analyst no longer files a request to change their X handle: an admin links
it directly, or an invite binds it. ``x_handle_requests`` goes with the two
notification kinds that reported a decision. Their notification rows, their
unsent emails and their stored email switches are deleted.

The downgrade recreates the table empty.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e15b788dcaf0"
down_revision: Union[str, None] = "6a3943ca4316"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_REMOVED = ("x_handle_request_approved", "x_handle_request_declined")
_KINDS_AFTER = (
    "request_fulfilled",
    "new_follower",
    "co_geolocator_invite",
    "co_geolocator_removed",
    "ownership_transferred",
    "organization_invite",
    "organization_invite_accepted",
    "organization_manager_inherited",
    "re_approve_requested",
    "approval_received",
    "approval_revoked",
    "approval_request_received",
    "approval_request_declined",
    "organization_approval_removed",
)
_KINDS_BEFORE = _KINDS_AFTER[:2] + _REMOVED + _KINDS_AFTER[2:]


def _in(values: tuple[str, ...]) -> str:
    return "(" + ", ".join(f"'{v}'" for v in values) + ")"


def _set_kinds(kinds: tuple[str, ...]) -> None:
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", f"kind IN {_in(kinds)}")


def upgrade() -> None:
    op.execute(
        "DELETE FROM notification_deliveries WHERE status = 'queued' AND notification_id IN "
        f"(SELECT id FROM notifications WHERE kind IN {_in(_REMOVED)})"
    )
    op.execute(f"DELETE FROM notifications WHERE kind IN {_in(_REMOVED)}")
    op.execute(
        "UPDATE user_preferences SET notification_overrides = notification_overrides "
        f"- '{_REMOVED[0]}' - '{_REMOVED[1]}'"
    )
    _set_kinds(_KINDS_AFTER)
    op.drop_table("x_handle_requests")


def downgrade() -> None:
    op.create_table(
        "x_handle_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("x_handle", sa.String(length=50), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("decline_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'declined')",
            name="ck_x_handle_requests_status_valid",
        ),
        sa.CheckConstraint(
            "(status = 'declined') = (decline_reason IS NOT NULL AND decided_at IS NOT NULL)",
            name="ck_x_handle_requests_decision_stamp",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    _set_kinds(_KINDS_BEFORE)
