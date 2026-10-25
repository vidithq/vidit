"""number an unpublished event version 0

Revision ID: a2c4e6f8b0d1
Revises: fdb3f51c1477
Create Date: 2026-10-25 10:00:00.000000

A request or a detection, open or closed, is version 0; publishing it files that state as
version 0 in ``event_versions`` and the published row becomes version 1. Every row that was
never published moves from 1 to 0. Such a row carries no ``event_versions``, approval or
approval request, since each of those needs a published row, so no stored number changes
meaning. The upgrade refuses to run if one does. ``ck_events_version_published`` then pins
the rule.
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "a2c4e6f8b0d1"
down_revision: Union[str, None] = "fdb3f51c1477"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT = "ck_events_version_published"
UNPUBLISHED = "COALESCE(before_closed_status, status) IN ('requested', 'detected')"


def upgrade() -> None:
    conn = op.get_bind()
    for table in ("event_versions", "event_approvals", "approval_requests"):
        referenced = conn.execute(
            text(
                f"SELECT count(*) FROM {table} t JOIN events e ON e.id = t.event_id"
                " WHERE COALESCE(e.before_closed_status, e.status) IN ('requested', 'detected')"
            )
        ).scalar_one()
        if referenced:
            raise RuntimeError(
                f"{referenced} {table} rows point at an event that was never published"
            )
    op.execute(f"UPDATE events SET version_no = 0 WHERE {UNPUBLISHED}")
    op.create_check_constraint(CONSTRAINT, "events", f"(version_no = 0) = ({UNPUBLISHED})")


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT, "events", type_="check")
    # A version 0 snapshot belongs to a published row; the old numbering has no place for it.
    op.execute("DELETE FROM event_versions WHERE version_no = 0")
    op.execute("UPDATE events SET version_no = 1 WHERE version_no = 0")
