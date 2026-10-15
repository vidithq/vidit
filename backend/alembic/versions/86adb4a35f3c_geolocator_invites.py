"""add event_geolocator_invites and the co-geolocator notification kinds

Revision ID: 86adb4a35f3c
Revises: aa0046e600ab
Create Date: 2026-10-15 10:00:00.000000

``event_geolocator_invites`` holds one pending invitation per analyst and
event. Accepting deletes the row and inserts the ``event_geolocators`` row in
one transaction; declining or a withdrawal deletes it. Both foreign keys
cascade, so an erased invitee or a hard-deleted event takes its invitations
along. No backfill: no invitation exists before this table.

``ck_notifications_kind_valid`` widens to the three kinds the shared credit
emits: ``co_geolocator_invite``, ``co_geolocator_removed`` and
``ownership_transferred``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "86adb4a35f3c"
down_revision: Union[str, None] = "aa0046e600ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_BEFORE = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined')"
)
_KINDS_AFTER = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred')"
)


def upgrade() -> None:
    op.create_table(
        "event_geolocator_invites",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "user_id"),
    )
    op.create_index(
        "ix_event_geolocator_invites_user_id", "event_geolocator_invites", ["user_id"]
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_AFTER)


def downgrade() -> None:
    op.execute(
        "DELETE FROM notifications WHERE kind IN"
        " ('co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred')"
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_BEFORE)
    op.drop_index("ix_event_geolocator_invites_user_id", table_name="event_geolocator_invites")
    op.drop_table("event_geolocator_invites")
