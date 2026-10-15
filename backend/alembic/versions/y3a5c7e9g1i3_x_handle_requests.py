"""add x_handle_requests and the two request outcome notification kinds

Revision ID: y3a5c7e9g1i3
Revises: w1y3a5c7e9g1
Create Date: 2026-10-15 10:00:00.000000

``x_handle_requests`` holds at most one row per analyst (``user_id`` UNIQUE):
the X handle they ask an admin to bind to their account, and a decline
reason once an admin declines it. An approval writes ``users.x_handle``
through the admin write path and deletes the row. A new request replaces the
old row. The row goes with its analyst (``ON DELETE CASCADE``).

``ck_notifications_kind_valid`` widens to the two outcome kinds,
``x_handle_request_approved`` and ``x_handle_request_declined``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "y3a5c7e9g1i3"
down_revision: Union[str, None] = "w1y3a5c7e9g1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_BEFORE = "kind IN ('request_fulfilled', 'new_follower')"
_KINDS_AFTER = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined')"
)


def upgrade() -> None:
    op.create_table(
        "x_handle_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("x_handle", sa.String(length=50), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("decline_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'declined')",
            name="ck_x_handle_requests_status_valid",
        ),
        sa.CheckConstraint(
            "(status = 'declined') = (decline_reason IS NOT NULL AND decided_at IS NOT NULL)",
            name="ck_x_handle_requests_decision_stamp",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )

    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_AFTER)


def downgrade() -> None:
    op.execute(
        "DELETE FROM notifications WHERE kind IN "
        "('x_handle_request_approved', 'x_handle_request_declined')"
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_BEFORE)
    op.drop_table("x_handle_requests")
