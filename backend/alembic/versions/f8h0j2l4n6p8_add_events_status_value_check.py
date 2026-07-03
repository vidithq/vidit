"""add a value-domain CHECK on events.status

The ``status`` column is a ``String(20)``; until now only
``ck_events_location_status`` (location vs status) constrained it, never the
value domain. This pins it to the four ``EventStatus`` values at the database,
so a bad write (a typo, or a new state the location CHECK happens to ignore) is
rejected by Postgres rather than only by the app-layer ``Literal``. Mirror of
``models.event.EventStatus``: keep the two in step.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "f8h0j2l4n6p8"
down_revision: Union[str, None] = "e7g9i1k3m5o7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_events_status_valid",
        "events",
        "status IN ('requested', 'detected', 'geolocated', 'closed')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_events_status_valid", "events", type_="check")
