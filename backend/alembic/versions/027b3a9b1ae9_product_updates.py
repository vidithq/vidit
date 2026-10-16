"""add product update consents, announcements and their email queue

Revision ID: 027b3a9b1ae9
Revises: b778064d364a
Create Date: 2026-10-15 14:00:00.000000

``product_update_consents`` records each grant of consent to product update
emails: when, from where (``sign_up`` or ``settings``), and when it was
withdrawn. A later grant adds a row, so a withdrawal is never overwritten. The
partial unique index keeps one current grant per analyst.

``pending_registrations.product_updates_consented_at`` holds the sign-up
form's choice until confirmation copies it into a consent row.

``product_updates`` holds one row per announcement sent, unique on its release
label. ``product_update_deliveries`` is its email queue, one row per
announcement and recipient, drained by the always-on worker under its own
daily cap. No backfill: nobody has consented yet.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "027b3a9b1ae9"
down_revision: Union[str, None] = "b778064d364a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "pending_registrations",
        sa.Column("product_updates_consented_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "product_update_consents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "source IN ('sign_up', 'settings')", name="ck_product_update_consents_source_valid"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_product_update_consents_current",
        "product_update_consents",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("withdrawn_at IS NULL"),
    )
    op.create_table(
        "product_updates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("link_url", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Uuid(), nullable=True),
        sa.Column("recipient_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["sent_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("label"),
    )
    op.create_table(
        "product_update_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_update_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'sending', 'sent', 'failed', 'skipped')",
            name="ck_product_update_deliveries_status_valid",
        ),
        sa.ForeignKeyConstraint(
            ["product_update_id"], ["product_updates.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "product_update_id", "user_id", name="uq_product_update_deliveries_user"
        ),
    )
    op.create_index(
        "ix_product_update_deliveries_user_id", "product_update_deliveries", ["user_id"]
    )
    op.create_index(
        "ix_product_update_deliveries_queued",
        "product_update_deliveries",
        ["created_at"],
        postgresql_where=sa.text("status = 'queued'"),
    )
    op.create_index(
        "ix_product_update_deliveries_sent_at",
        "product_update_deliveries",
        ["sent_at"],
        postgresql_where=sa.text("status = 'sent'"),
    )


def downgrade() -> None:
    op.drop_index("ix_product_update_deliveries_sent_at", table_name="product_update_deliveries")
    op.drop_index("ix_product_update_deliveries_queued", table_name="product_update_deliveries")
    op.drop_index("ix_product_update_deliveries_user_id", table_name="product_update_deliveries")
    op.drop_table("product_update_deliveries")
    op.drop_table("product_updates")
    op.drop_index("uq_product_update_consents_current", table_name="product_update_consents")
    op.drop_table("product_update_consents")
    op.drop_column("pending_registrations", "product_updates_consented_at")
