"""index detections in the feed keyset

Revision ID: fdb3f51c1477
Revises: fb4098ed6742
Create Date: 2026-10-24 20:00:00.000000

``GET /feed`` serves ``detected`` rows, keyed on ``detected_at``. ``ix_events_timeline_at_id``
is rebuilt on the new ``models/event.feed_at`` expression, with ``detected`` in its partial
predicate. The expression must stay identical to ``models/event.feed_at``: the planner matches
an expression index structurally and falls back to a sort on any difference.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fdb3f51c1477"
down_revision: Union[str, None] = "fb4098ed6742"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = "ix_events_timeline_at_id"


def _create(expression: str, statuses: str) -> None:
    op.create_index(
        INDEX,
        "events",
        [sa.text(expression), "id"],
        postgresql_where=sa.text(
            f"deleted_at IS NULL AND hidden_at IS NULL AND status IN ({statuses})"
        ),
    )


def upgrade() -> None:
    op.drop_index(INDEX, table_name="events")
    _create(
        "coalesce(CASE WHEN (status = 'requested') THEN requested_at"
        " WHEN (status = 'detected') THEN detected_at"
        " ELSE geolocated_at END, created_at)",
        "'geolocated', 'requested', 'detected'",
    )


def downgrade() -> None:
    op.drop_index(INDEX, table_name="events")
    _create(
        "coalesce(CASE WHEN (status = 'requested') THEN requested_at"
        " ELSE geolocated_at END, created_at)",
        "'geolocated', 'requested'",
    )
