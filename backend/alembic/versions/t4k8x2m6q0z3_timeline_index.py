"""index the timeline keyset

Revision ID: t4k8x2m6q0z3
Revises: c110dacdb047
Create Date: 2026-10-15 09:00:00.000000

``GET /timeline`` orders by ``timeline_at DESC, id DESC``, where ``timeline_at`` is an
expression (``models/event.timeline_at``), and filters to visible ``geolocated`` and
``requested`` rows. Without an index on that expression every page sorts every row the
filter keeps. This partial expression index holds the same rows in the same order, so a page
reads the first rows of an index scan.

The expression must stay identical to ``models/event.timeline_at``: the planner matches an
expression index structurally and falls back to a sort on any difference.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "t4k8x2m6q0z3"
down_revision: Union[str, None] = "c110dacdb047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_events_timeline_at_id",
        "events",
        [
            sa.text(
                "coalesce(CASE WHEN (status = 'requested') THEN requested_at"
                " ELSE geolocated_at END, created_at)"
            ),
            "id",
        ],
        postgresql_where=sa.text(
            "deleted_at IS NULL AND hidden_at IS NULL AND status IN ('geolocated', 'requested')"
        ),
    )


def downgrade() -> None:
    op.drop_index("ix_events_timeline_at_id", table_name="events")
