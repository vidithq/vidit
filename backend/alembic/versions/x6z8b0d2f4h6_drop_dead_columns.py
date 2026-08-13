"""drop users.claimed_at, bot_mentions.liked_at, invite_codes.created_by

Revision ID: x6z8b0d2f4h6
Revises: w5y7a9c1e3g5
Create Date: 2026-08-13 12:30:00.000000

Three columns no code path reads:

* ``users.claimed_at`` duplicated ``created_at`` once the assembled-profile
  mechanism was retired: every live row carries the insert timestamp.
* ``bot_mentions.liked_at`` outlived the gesture budget that stamped it.
* ``invite_codes.created_by`` is written at mint time and read nowhere; it is
  on no wire shape and no admin surface.

Also narrows ``ck_auth_tokens_purpose`` to the one purpose the application
mints. The ``email_verification`` value has no producer: pre-creation email
confirmation holds its token on ``pending_registrations.token_hash`` and never
touches ``auth_tokens``.

Downgrade re-adds all three columns (``claimed_at`` backfilled from
``created_at``, the other two NULL) and widens the CHECK again.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "x6z8b0d2f4h6"
down_revision: Union[str, None] = "w5y7a9c1e3g5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "claimed_at")
    op.drop_column("bot_mentions", "liked_at")
    op.drop_constraint("invite_codes_created_by_fkey", "invite_codes", type_="foreignkey")
    op.drop_column("invite_codes", "created_by")

    op.drop_constraint("ck_auth_tokens_purpose", "auth_tokens", type_="check")
    op.create_check_constraint(
        "ck_auth_tokens_purpose", "auth_tokens", "purpose IN ('password_reset')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_auth_tokens_purpose", "auth_tokens", type_="check")
    op.create_check_constraint(
        "ck_auth_tokens_purpose",
        "auth_tokens",
        "purpose IN ('password_reset', 'email_verification')",
    )

    op.add_column("invite_codes", sa.Column("created_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "invite_codes_created_by_fkey",
        "invite_codes",
        "users",
        ["created_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "bot_mentions", sa.Column("liked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "users",
        sa.Column(
            "claimed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
    )
    op.execute("UPDATE users SET claimed_at = created_at")
