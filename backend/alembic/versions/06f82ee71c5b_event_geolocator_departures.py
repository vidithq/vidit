"""add event_geolocator_departures

Revision ID: 06f82ee71c5b
Revises: 7a57bbdce722
Create Date: 2026-10-16 09:00:00.000000

One row per analyst who held credit on an event and lost it, removed by the
owner or leaving. Approving the event and being asked to review it are refused
to a former geolocator as to a current one. Earlier departures left no trace, so
the table starts empty.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "06f82ee71c5b"
down_revision: Union[str, None] = "7a57bbdce722"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "event_geolocator_departures",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "user_id"),
    )
    op.create_index(
        "ix_event_geolocator_departures_user_id", "event_geolocator_departures", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_event_geolocator_departures_user_id", table_name="event_geolocator_departures"
    )
    op.drop_table("event_geolocator_departures")
