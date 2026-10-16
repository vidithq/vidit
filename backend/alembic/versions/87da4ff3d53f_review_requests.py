"""add review_requests, the review request audience and its notification kinds

Revision ID: 87da4ff3d53f
Revises: 081e5a75dc49
Create Date: 2026-10-15 18:00:00.000000

``review_requests`` holds one geolocator's request that an analyst review an
event. It is open until the target approves the event or declines, and the row
stays once resolved. A partial unique index allows one open request per
requester, target and event.

``user_preferences.review_request_audience`` says who may send the analyst a
request; existing rows take the default, ``following``.

``ck_notifications_kind_valid`` widens to ``review_request_received`` and
``review_request_declined``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "87da4ff3d53f"
down_revision: Union[str, None] = "081e5a75dc49"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_BEFORE = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_admin_inherited', 're_approve_requested', 'approval_received')"
)
_KINDS_AFTER = (
    "kind IN ('request_fulfilled', 'new_follower', "
    "'x_handle_request_approved', 'x_handle_request_declined', "
    "'co_geolocator_invite', 'co_geolocator_removed', 'ownership_transferred', "
    "'organization_invite', 'organization_invite_accepted', "
    "'organization_admin_inherited', 're_approve_requested', 'approval_received', "
    "'review_request_received', 'review_request_declined')"
)


def upgrade() -> None:
    op.create_table(
        "review_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("requester_id", sa.Uuid(), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'open'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('open', 'approved', 'declined')", name="ck_review_requests_status_valid"
        ),
        sa.CheckConstraint(
            "(status = 'open') = (resolved_at IS NULL)", name="ck_review_requests_resolved"
        ),
        sa.CheckConstraint("target_user_id IS NOT NULL", name="ck_review_requests_one_target"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_review_requests_open",
        "review_requests",
        ["event_id", "target_user_id", "requester_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )
    op.create_index(
        "ix_review_requests_target_user_id", "review_requests", ["target_user_id", "status"]
    )
    op.create_index(
        "ix_review_requests_requester_created_at",
        "review_requests",
        ["requester_id", "created_at"],
    )
    op.add_column(
        "user_preferences",
        sa.Column(
            "review_request_audience",
            sa.String(length=20),
            server_default=sa.text("'following'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_user_preferences_review_request_audience",
        "user_preferences",
        "review_request_audience IN ('following', 'everyone', 'nobody')",
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_AFTER)


def downgrade() -> None:
    op.execute("DELETE FROM notifications"
        " WHERE kind IN ('review_request_received', 'review_request_declined')"
    )
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", _KINDS_BEFORE)
    op.drop_constraint(
        "ck_user_preferences_review_request_audience", "user_preferences", type_="check"
    )
    op.drop_column("user_preferences", "review_request_audience")
    op.drop_index("ix_review_requests_requester_created_at", table_name="review_requests")
    op.drop_index("ix_review_requests_target_user_id", table_name="review_requests")
    op.drop_index("uq_review_requests_open", table_name="review_requests")
    op.drop_table("review_requests")
