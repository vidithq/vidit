"""an organization's approvals are revoked by any of its members

Revision ID: 08816f528cbf
Revises: 0c2f6f5dfd3f
Create Date: 2026-10-17 15:00:00.000000

Any member of an organization approves and revokes in its name, so
``event_approvals.revoked_as`` ``organization_manager`` becomes
``organization_member``. The check constraint is dropped, the rows converted,
and the constraint recreated with the new value. The downgrade converts back.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "08816f528cbf"
down_revision: Union[str, None] = "0c2f6f5dfd3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CHECK = "ck_event_approvals_revoked_as_valid"


def _convert(old: str, new: str) -> None:
    op.drop_constraint(_CHECK, "event_approvals", type_="check")
    op.execute(f"UPDATE event_approvals SET revoked_as = '{new}' WHERE revoked_as = '{old}'")
    op.create_check_constraint(
        _CHECK, "event_approvals", f"revoked_as IN ('reviewer', '{new}', 'site_admin')"
    )


def upgrade() -> None:
    _convert("organization_manager", "organization_member")


def downgrade() -> None:
    _convert("organization_member", "organization_manager")
