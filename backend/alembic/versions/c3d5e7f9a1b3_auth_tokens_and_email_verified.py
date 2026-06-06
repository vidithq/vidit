"""auth_tokens table + users.email_verified_at

Revision ID: c3d5e7f9a1b3
Revises: b2c4d6e8f0a2
Create Date: 2026-05-06 17:30:00.000000

Adds the recovery-channel infrastructure required before the first analyst
invite goes out:

* `users.email_verified_at` — soft-verify timestamp; NULL means unverified
  (banner shown on the frontend, does NOT block sign-in).
* `auth_tokens` — single shared table for password-reset and email-
  verification tokens. We hash the random secret at rest so a DB read
  doesn't expose live tokens. The partial index on `expires_at` for
  unconsumed rows keeps the periodic reaper cheap.

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c3d5e7f9a1b3"
down_revision: Union[str, None] = "b2c4d6e8f0a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_auth_tokens_token_hash"),
        sa.CheckConstraint(
            "purpose IN ('password_reset', 'email_verification')",
            name="ck_auth_tokens_purpose",
        ),
    )
    op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"])
    op.create_index(
        "ix_auth_tokens_user_purpose",
        "auth_tokens",
        ["user_id", "purpose"],
    )
    # Reaper scans (consumed_at IS NULL AND expires_at < now()) by created_at
    # — partial index keeps it cheap as consumed rows accumulate.
    op.create_index(
        "ix_auth_tokens_live_expires_at",
        "auth_tokens",
        ["expires_at"],
        postgresql_where=sa.text("consumed_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_auth_tokens_live_expires_at", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_user_purpose", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_user_id", table_name="auth_tokens")
    op.drop_table("auth_tokens")
    op.drop_column("users", "email_verified_at")
