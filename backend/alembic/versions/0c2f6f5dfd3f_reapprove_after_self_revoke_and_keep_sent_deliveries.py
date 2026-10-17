"""re-approval after a self-revoke, and sent deliveries outlive their notification

Revision ID: 0c2f6f5dfd3f
Revises: 32730fceee8a
Create Date: 2026-10-17 12:00:00.000000

- ``uq_event_approvals_analyst`` covers live rows only, so an analyst who
  revoked their own approval of a version can approve it again in a new row.
- ``notification_deliveries.notification_id`` turns nullable with
  ``ON DELETE SET NULL``: deleting a notification keeps its sent rows, which
  the daily email cap counts.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0c2f6f5dfd3f"
down_revision: Union[str, None] = "32730fceee8a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK = "notification_deliveries_notification_id_fkey"


def _analyst_index(where: str) -> None:
    op.create_index(
        "uq_event_approvals_analyst",
        "event_approvals",
        ["event_id", "version_no", "reviewer_id"],
        unique=True,
        postgresql_where=sa.text(where),
    )


def _delivery_fk(ondelete: str) -> None:
    op.create_foreign_key(
        _FK,
        "notification_deliveries",
        "notifications",
        ["notification_id"],
        ["id"],
        ondelete=ondelete,
    )


def upgrade() -> None:
    op.drop_index("uq_event_approvals_analyst", table_name="event_approvals")
    _analyst_index("organization_id IS NULL AND revoked_at IS NULL")
    op.drop_constraint(_FK, "notification_deliveries", type_="foreignkey")
    op.alter_column("notification_deliveries", "notification_id", nullable=True)
    _delivery_fk("SET NULL")


def downgrade() -> None:
    op.execute("DELETE FROM notification_deliveries WHERE notification_id IS NULL")
    op.drop_constraint(_FK, "notification_deliveries", type_="foreignkey")
    op.alter_column("notification_deliveries", "notification_id", nullable=False)
    _delivery_fk("CASCADE")
    # One review per analyst and version again: keep each analyst's newest row of a version.
    op.execute(
        "DELETE FROM event_approvals a USING event_approvals b "
        "WHERE a.organization_id IS NULL AND b.organization_id IS NULL "
        "AND a.event_id = b.event_id AND a.version_no = b.version_no "
        "AND a.reviewer_id = b.reviewer_id AND a.created_at < b.created_at"
    )
    op.drop_index("uq_event_approvals_analyst", table_name="event_approvals")
    _analyst_index("organization_id IS NULL")
