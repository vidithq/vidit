"""admin role + invite-code quotas + admin_events

Revision ID: d4e6f8a0b2c4
Revises: c3d5e7f9a1b3
Create Date: 2026-05-09 10:00:00.000000

First-invite admin tooling foundation:

* `users.is_admin` — boolean role; only `admin@vidit.app` (or anything in
  `ADMIN_EMAILS`) auto-promotes on login/register.
* `users.is_trusted` + `users.trust_reason` — substantiated trust mark.
  Column ships now (toggle UI lands later) so we don't re-migrate `users`
  for one column when the trust-signal feature catches up.
* `invite_codes.max_uses` / `use_count` / `revoked_at` — multi-use codes
  + admin revocation. Backfill marks every previously-consumed row as
  exhausted single-use so the new validity check
  `(max_uses IS NULL OR use_count < max_uses) AND revoked_at IS NULL`
  doesn't re-validate them as available.
* `admin_events` — small append-only audit table for admin actions.
  Sibling to (eventually merged with) the Tier 4 lite `auth_events`
  table that hasn't shipped yet.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d4e6f8a0b2c4"
down_revision: Union[str, None] = "c3d5e7f9a1b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users ───────────────────────────────────────────────────────────────
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "users",
        sa.Column("is_trusted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("users", sa.Column("trust_reason", sa.Text(), nullable=True))

    # ── invite_codes ────────────────────────────────────────────────────────
    op.add_column(
        "invite_codes",
        sa.Column("max_uses", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "invite_codes",
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "invite_codes",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Backfill: any code that was already consumed under the old single-use
    # model is now an exhausted single-use code. Without this, the new
    # validity check would treat them as available.
    op.execute(
        "UPDATE invite_codes "
        "SET use_count = 1, max_uses = 1 "
        "WHERE used_by IS NOT NULL"
    )

    # ── admin_events ────────────────────────────────────────────────────────
    op.create_table(
        "admin_events",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "actor_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_admin_events_actor_id", "admin_events", ["actor_id"])
    op.create_index("ix_admin_events_created_at", "admin_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_admin_events_created_at", table_name="admin_events")
    op.drop_index("ix_admin_events_actor_id", table_name="admin_events")
    op.drop_table("admin_events")

    op.drop_column("invite_codes", "revoked_at")
    op.drop_column("invite_codes", "use_count")
    op.drop_column("invite_codes", "max_uses")

    op.drop_column("users", "trust_reason")
    op.drop_column("users", "is_trusted")
    op.drop_column("users", "is_admin")
