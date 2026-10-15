"""add the organization_admin_inherited notification kind

Revision ID: 337bd8368ac6
Revises: 0d949366ad78
Create Date: 2026-10-15 12:00:00.000000

When an account erasure or soft delete removes an organization's last live
org-admin, the earliest-joined member inherits the role and receives an
``organization_admin_inherited`` notification. The kind joins
``ck_notifications_kind_valid``.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "337bd8368ac6"
down_revision: Union[str, None] = "0d949366ad78"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_BEFORE = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted')"
)
_KINDS_AFTER = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_admin_inherited')"
)


def upgrade() -> None:
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_AFTER)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'organization_admin_inherited'")
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_BEFORE)
