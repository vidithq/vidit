"""add organization approvals and organization review request targets

Revision ID: 7a57bbdce722
Revises: 87da4ff3d53f
Create Date: 2026-10-15 20:00:00.000000

``event_approvals.organization_id`` marks an approval an org-admin placed in an
organization's name; ``reviewer_id`` stays the acting member. The analyst
uniqueness becomes a partial index over the rows without an organization, and
a second partial index keeps one standing approval per organization and
version. ``revoked_as`` stamps who revoked (the reviewer, an org-admin or a site
admin); existing revoked rows take ``reviewer`` when the reviewer revoked and
``site_admin`` otherwise, which is the only other way an analyst approval was
revoked.

``review_requests.target_organization_id`` is the sibling target, and
``ck_review_requests_one_target`` requires exactly one of the two.
``organizations.review_request_audience`` says who may send the organization a
request; existing rows take the default, ``following``.

No notification kind is added, so ``ck_notifications_kind_valid`` is unchanged.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7a57bbdce722"
down_revision: Union[str, None] = "87da4ff3d53f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("event_approvals", sa.Column("organization_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "event_approvals_organization_id_fkey",
        "event_approvals",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column("event_approvals", sa.Column("revoked_as", sa.String(length=20), nullable=True))
    op.execute(
        "UPDATE event_approvals SET revoked_as = CASE WHEN revoked_by_id = reviewer_id"
        " THEN 'reviewer' ELSE 'site_admin' END WHERE revoked_at IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_event_approvals_revoked_as_valid",
        "event_approvals",
        "revoked_as IN ('reviewer', 'organization_admin', 'site_admin')",
    )
    op.create_check_constraint(
        "ck_event_approvals_revoked_as",
        "event_approvals",
        "(revoked_at IS NULL) = (revoked_as IS NULL)",
    )
    op.drop_constraint(
        "uq_event_approvals_event_version_reviewer", "event_approvals", type_="unique"
    )
    op.create_index(
        "uq_event_approvals_analyst",
        "event_approvals",
        ["event_id", "version_no", "reviewer_id"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NULL"),
    )
    op.create_index(
        "uq_event_approvals_organization",
        "event_approvals",
        ["event_id", "version_no", "organization_id"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NOT NULL AND revoked_at IS NULL"),
    )
    op.create_index(
        "ix_event_approvals_organization_created_at",
        "event_approvals",
        ["organization_id", "created_at"],
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )

    op.add_column(
        "review_requests", sa.Column("target_organization_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "review_requests_target_organization_id_fkey",
        "review_requests",
        "organizations",
        ["target_organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("ck_review_requests_one_target", "review_requests", type_="check")
    op.create_check_constraint(
        "ck_review_requests_one_target",
        "review_requests",
        "num_nonnulls(target_user_id, target_organization_id) = 1",
    )
    op.create_index(
        "uq_review_requests_open_organization",
        "review_requests",
        ["event_id", "target_organization_id", "requester_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open' AND target_organization_id IS NOT NULL"),
    )
    op.create_index(
        "ix_review_requests_target_organization_id",
        "review_requests",
        ["target_organization_id", "status"],
        postgresql_where=sa.text("target_organization_id IS NOT NULL"),
    )

    op.add_column(
        "organizations",
        sa.Column(
            "review_request_audience",
            sa.String(length=20),
            server_default=sa.text("'following'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_organizations_review_request_audience",
        "organizations",
        "review_request_audience IN ('following', 'everyone', 'nobody')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_organizations_review_request_audience", "organizations", type_="check"
    )
    op.drop_column("organizations", "review_request_audience")

    op.execute("DELETE FROM review_requests WHERE target_organization_id IS NOT NULL")
    op.drop_index("ix_review_requests_target_organization_id", table_name="review_requests")
    op.drop_index("uq_review_requests_open_organization", table_name="review_requests")
    op.drop_constraint("ck_review_requests_one_target", "review_requests", type_="check")
    op.create_check_constraint(
        "ck_review_requests_one_target", "review_requests", "target_user_id IS NOT NULL"
    )
    op.drop_constraint(
        "review_requests_target_organization_id_fkey", "review_requests", type_="foreignkey"
    )
    op.drop_column("review_requests", "target_organization_id")

    op.execute("DELETE FROM event_approvals WHERE organization_id IS NOT NULL")
    op.drop_index("ix_event_approvals_organization_created_at", table_name="event_approvals")
    op.drop_index("uq_event_approvals_organization", table_name="event_approvals")
    op.drop_index("uq_event_approvals_analyst", table_name="event_approvals")
    op.create_unique_constraint(
        "uq_event_approvals_event_version_reviewer",
        "event_approvals",
        ["event_id", "version_no", "reviewer_id"],
    )
    op.drop_constraint("ck_event_approvals_revoked_as", "event_approvals", type_="check")
    op.drop_constraint("ck_event_approvals_revoked_as_valid", "event_approvals", type_="check")
    op.drop_column("event_approvals", "revoked_as")
    op.drop_constraint(
        "event_approvals_organization_id_fkey", "event_approvals", type_="foreignkey"
    )
    op.drop_column("event_approvals", "organization_id")
