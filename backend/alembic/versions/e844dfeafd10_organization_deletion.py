"""add organization_approval_removed and notifications.organization_name

Revision ID: e844dfeafd10
Revises: 949fed6a7caf
Create Date: 2026-10-16 17:00:00.000000

A site admin deletes an organization, and every approval given in its name goes
with it. The owner of each event that loses one receives an
``organization_approval_removed`` notification. The organization row is gone by
then, so ``notifications.organization_name`` keeps the name the row prints.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e844dfeafd10"
down_revision: Union[str, None] = "949fed6a7caf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS = (
    "'request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_manager_inherited', 're_approve_requested', 'approval_received', "
    "'review_request_received', 'review_request_declined'"
)


def upgrade() -> None:
    op.add_column(
        "notifications", sa.Column("organization_name", sa.String(length=100), nullable=True)
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint(
        "ck_notifications_kind_valid",
        "notifications",
        "kind IN (" + _KINDS + ", 'organization_approval_removed')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'organization_approval_removed'")
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", "kind IN (" + _KINDS + ")")
    op.drop_column("notifications", "organization_name")
