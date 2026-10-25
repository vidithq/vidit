"""final approvals

Revision ID: 7e8e211df661
Revises: d4827e29651e
Create Date: 2026-10-24 09:30:00.000000

An approval is final: nobody revokes it. A row is deleted when its reviewer
joins the event's geolocators, or by a site admin. The revoked approvals are
deleted, with the notifications that reported them, and the revocation
columns go. The ``approval_revoked`` notification kind goes with its rows,
their unsent emails and the stored email switches. ``verdict`` (one value,
never read) and the optional ``note`` go too. The two unique indexes keep one
approval per reviewer, or organization, and version.

The downgrade restores the columns and constraints; the deleted approvals,
notes and notifications are not restored.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7e8e211df661"
down_revision: Union[str, None] = "d4827e29651e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KINDS_AFTER = (
    "request_fulfilled",
    "new_follower",
    "co_geolocator_invite",
    "co_geolocator_removed",
    "ownership_transferred",
    "organization_invite",
    "organization_invite_accepted",
    "organization_manager_inherited",
    "re_approve_requested",
    "approval_received",
    "approval_request_received",
    "approval_request_declined",
    "organization_approval_removed",
)
_KINDS_BEFORE = _KINDS_AFTER[:10] + ("approval_revoked",) + _KINDS_AFTER[10:]


def _set_kinds(kinds: tuple[str, ...]) -> None:
    allowed = ", ".join(f"'{k}'" for k in kinds)
    op.drop_constraint("ck_notifications_kind_valid", "notifications", type_="check")
    op.create_check_constraint("ck_notifications_kind_valid", "notifications", f"kind IN ({allowed})")


def _unique_indexes(revoked_filter: str) -> None:
    op.create_index(
        "uq_event_approvals_analyst",
        "event_approvals",
        ["event_id", "version_no", "reviewer_id"],
        unique=True,
        postgresql_where=sa.text(f"organization_id IS NULL{revoked_filter}"),
    )
    op.create_index(
        "uq_event_approvals_organization",
        "event_approvals",
        ["event_id", "version_no", "organization_id"],
        unique=True,
        postgresql_where=sa.text(f"organization_id IS NOT NULL{revoked_filter}"),
    )


def upgrade() -> None:
    op.execute(
        "DELETE FROM notification_deliveries WHERE status = 'queued' AND notification_id IN "
        "(SELECT id FROM notifications WHERE kind = 'approval_revoked')"
    )
    op.execute("DELETE FROM notifications WHERE kind = 'approval_revoked'")
    op.execute(
        "UPDATE user_preferences SET notification_overrides = "
        "notification_overrides - 'approval_revoked'"
    )
    _set_kinds(_KINDS_AFTER)

    op.execute("DELETE FROM event_approvals WHERE revoked_at IS NOT NULL")
    op.drop_index("uq_event_approvals_analyst", table_name="event_approvals")
    op.drop_index("uq_event_approvals_organization", table_name="event_approvals")
    _unique_indexes("")
    op.drop_index("ix_event_approvals_revoked_by_id", table_name="event_approvals")
    for check in (
        "ck_event_approvals_revoke_reason",
        "ck_event_approvals_revoked_as",
        "ck_event_approvals_revoked_as_valid",
        "ck_event_approvals_verdict_valid",
    ):
        op.drop_constraint(check, "event_approvals", type_="check")
    op.drop_constraint("event_approvals_revoked_by_id_fkey", "event_approvals", type_="foreignkey")
    for column in ("revoked_at", "revoked_by_id", "revoke_reason", "revoked_as", "verdict", "note"):
        op.drop_column("event_approvals", column)


def downgrade() -> None:
    op.add_column("event_approvals", sa.Column("note", sa.Text(), nullable=True))
    op.add_column(
        "event_approvals",
        sa.Column(
            "verdict", sa.String(length=20), nullable=False, server_default=sa.text("'approve'")
        ),
    )
    op.add_column(
        "event_approvals", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("event_approvals", sa.Column("revoked_by_id", sa.Uuid(), nullable=True))
    op.add_column("event_approvals", sa.Column("revoke_reason", sa.Text(), nullable=True))
    op.add_column("event_approvals", sa.Column("revoked_as", sa.String(length=20), nullable=True))
    op.create_foreign_key(
        "event_approvals_revoked_by_id_fkey",
        "event_approvals",
        "users",
        ["revoked_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "ck_event_approvals_verdict_valid", "event_approvals", "verdict IN ('approve')"
    )
    op.create_check_constraint(
        "ck_event_approvals_revoke_reason",
        "event_approvals",
        "revoke_reason IS NULL OR revoked_at IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_event_approvals_revoked_as_valid",
        "event_approvals",
        "revoked_as IN ('reviewer', 'organization_member', 'site_admin')",
    )
    op.create_check_constraint(
        "ck_event_approvals_revoked_as",
        "event_approvals",
        "(revoked_at IS NULL) = (revoked_as IS NULL)",
    )
    op.create_index(
        "ix_event_approvals_revoked_by_id",
        "event_approvals",
        ["revoked_by_id"],
        postgresql_where=sa.text("revoked_by_id IS NOT NULL"),
    )
    op.drop_index("uq_event_approvals_analyst", table_name="event_approvals")
    op.drop_index("uq_event_approvals_organization", table_name="event_approvals")
    _unique_indexes(" AND revoked_at IS NULL")
    _set_kinds(_KINDS_BEFORE)
