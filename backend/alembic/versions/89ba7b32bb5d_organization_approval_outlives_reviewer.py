"""keep an organization's approval when the acting org-admin's account is erased

Revision ID: 89ba7b32bb5d
Revises: e8d74c4e51a4
Create Date: 2026-10-16 09:20:00.000000

``event_approvals.reviewer_id`` turns nullable with ON DELETE SET NULL, so an
approval placed in an organization's name outlives the account of the org-admin
who placed it. An analyst's own approval still goes with their account:
``admin.hard_delete_user`` deletes it before the user row, and
``ck_event_approvals_reviewer`` refuses a NULL reviewer on a row without an
organization.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "89ba7b32bb5d"
down_revision: Union[str, None] = "e8d74c4e51a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("event_approvals_reviewer_id_fkey", "event_approvals", type_="foreignkey")
    op.alter_column("event_approvals", "reviewer_id", existing_type=sa.Uuid(), nullable=True)
    op.create_foreign_key(
        "event_approvals_reviewer_id_fkey",
        "event_approvals",
        "users",
        ["reviewer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "ck_event_approvals_reviewer",
        "event_approvals",
        "reviewer_id IS NOT NULL OR organization_id IS NOT NULL",
    )


def downgrade() -> None:
    op.execute("DELETE FROM event_approvals WHERE reviewer_id IS NULL")
    op.drop_constraint("ck_event_approvals_reviewer", "event_approvals", type_="check")
    op.drop_constraint("event_approvals_reviewer_id_fkey", "event_approvals", type_="foreignkey")
    op.alter_column("event_approvals", "reviewer_id", existing_type=sa.Uuid(), nullable=False)
    op.create_foreign_key(
        "event_approvals_reviewer_id_fkey",
        "event_approvals",
        "users",
        ["reviewer_id"],
        ["id"],
        ondelete="CASCADE",
    )
