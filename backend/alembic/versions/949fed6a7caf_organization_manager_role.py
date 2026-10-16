"""rename the organization role org-admin to org manager

Revision ID: 949fed6a7caf
Revises: 38df4850a8bb
Create Date: 2026-10-16 15:00:00.000000

"Admin" names only the Vidit site admin. In the data:

- ``organization_members.role`` ``admin`` becomes ``manager``.
- The notification kind ``organization_admin_inherited`` becomes
  ``organization_manager_inherited``, on the rows and as a key of
  ``user_preferences.notification_overrides``. Delivery rows reference their
  notification by id and carry no kind.
- ``event_approvals.revoked_as`` ``organization_admin`` becomes
  ``organization_manager``.

Each check constraint is dropped, the rows converted, and the constraint
recreated with the new value. The downgrade converts back.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "949fed6a7caf"
down_revision: Union[str, None] = "38df4850a8bb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS = (
    "'request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'{inherited}', 're_approve_requested', 'approval_received', "
    "'review_request_received', 'review_request_declined'"
)


def _convert(*, role: tuple[str, str], kind: tuple[str, str], revoker: tuple[str, str]) -> None:
    (old_role, new_role), (old_kind, new_kind), (old_rev, new_rev) = role, kind, revoker

    op.drop_constraint(
        "ck_organization_members_role_valid", "organization_members", type_="check"
    )
    op.execute(
        f"UPDATE organization_members SET role = '{new_role}' WHERE role = '{old_role}'"
    )
    op.create_check_constraint(
        "ck_organization_members_role_valid",
        "organization_members",
        f"role IN ('{new_role}', 'member')",
    )

    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.execute(f"UPDATE notifications SET kind = '{new_kind}' WHERE kind = '{old_kind}'")
    op.execute(
        "UPDATE user_preferences SET notification_overrides = "
        f"(notification_overrides - '{old_kind}') || jsonb_build_object("
        f"'{new_kind}', notification_overrides -> '{old_kind}') "
        f"WHERE notification_overrides ? '{old_kind}'"
    )
    op.create_check_constraint(
        "ck_notifications_kind_valid",
        "notifications",
        "kind IN (" + _KINDS.format(inherited=new_kind) + ")",
    )

    op.drop_constraint("ck_event_approvals_revoked_as_valid", "event_approvals", type_="check")
    op.execute(
        f"UPDATE event_approvals SET revoked_as = '{new_rev}' WHERE revoked_as = '{old_rev}'"
    )
    op.create_check_constraint(
        "ck_event_approvals_revoked_as_valid",
        "event_approvals",
        f"revoked_as IN ('reviewer', '{new_rev}', 'site_admin')",
    )


def upgrade() -> None:
    _convert(
        role=("admin", "manager"),
        kind=("organization_admin_inherited", "organization_manager_inherited"),
        revoker=("organization_admin", "organization_manager"),
    )


def downgrade() -> None:
    _convert(
        role=("manager", "admin"),
        kind=("organization_manager_inherited", "organization_admin_inherited"),
        revoker=("organization_manager", "organization_admin"),
    )
