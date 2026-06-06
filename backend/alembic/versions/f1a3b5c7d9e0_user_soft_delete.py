"""users.deleted_at + invite_codes FKs ON DELETE SET NULL

Revision ID: f1a3b5c7d9e0
Revises: e7f9a1b3c5d7
Create Date: 2026-05-09 17:30:00.000000

User soft-delete pairs with the geolocation soft-delete (e7f9a1b3c5d7):

* `users.deleted_at` — same semantics as the geolocation column. Auth
  flows reject soft-deleted users (login + get_current_user); public
  reads filter `deleted_at IS NULL`. Hard-delete is the GDPR escape
  hatch: drops the user row + cascade-drops their submissions + sweeps
  S3 — same DB-commits-before-S3 ordering as the geolocation hard-delete.

* `invite_codes` FKs flipped to `ON DELETE SET NULL`. Without this, hard-
  deleting a user with minted-or-consumed invite codes would crash with
  a FK violation. Invite codes are part of the platform audit trail
  (who joined when), so we want them to survive even if the issuer or
  consumer disappears — null'd FKs preserve the row.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f1a3b5c7d9e0"
down_revision: Union[str, None] = "e7f9a1b3c5d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_users_live",
        "users",
        ["created_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    # ── invite_codes: created_by + used_by → ON DELETE SET NULL ────────────
    # Existing constraints are unnamed (Alembic auto-named in the initial
    # migration) — drop by the conventional Postgres-generated name and
    # recreate with the cascade rule.
    op.drop_constraint(
        "invite_codes_created_by_fkey", "invite_codes", type_="foreignkey"
    )
    op.create_foreign_key(
        "invite_codes_created_by_fkey",
        "invite_codes",
        "users",
        ["created_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_constraint(
        "invite_codes_used_by_fkey", "invite_codes", type_="foreignkey"
    )
    op.create_foreign_key(
        "invite_codes_used_by_fkey",
        "invite_codes",
        "users",
        ["used_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "invite_codes_used_by_fkey", "invite_codes", type_="foreignkey"
    )
    op.create_foreign_key(
        "invite_codes_used_by_fkey",
        "invite_codes",
        "users",
        ["used_by"],
        ["id"],
    )
    op.drop_constraint(
        "invite_codes_created_by_fkey", "invite_codes", type_="foreignkey"
    )
    op.create_foreign_key(
        "invite_codes_created_by_fkey",
        "invite_codes",
        "users",
        ["created_by"],
        ["id"],
    )

    op.drop_index("ix_users_live", table_name="users")
    op.drop_column("users", "deleted_at")
