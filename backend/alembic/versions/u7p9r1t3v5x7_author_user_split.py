"""author/user split — assembled profiles before login

Revision ID: u7p9r1t3v5x7
Revises: t6o8q0s2u4w6
Create Date: 2026-06-15 10:00:00.000000

Lets a ``users`` row exist as an *assembled profile* — built from a consented
X handle before its owner ever logs in — without a separate ``authors`` table.
``geolocations.author_id`` / ``bounties.author_id`` keep pointing at
``users.id`` untouched; the decoupling is a state on the existing row, not a
new FK target, so no author query changes.

Three changes:

- ``email`` / ``password_hash`` become nullable. An assembled profile has
  neither until claimed; both are still set for every self-registered or
  claimed account (the registration + claim flows write them). Dropping a
  NOT NULL is a metadata-only ALTER — no table rewrite.
- ``x_handle`` — the pre-claim identity anchor (an unclaimed row has no email),
  lowercased without ``@``, UNIQUE so re-consent reuses the existing profile
  instead of minting a second. Postgres permits unlimited NULLs under a UNIQUE
  constraint, so the existing handle-less rows don't collide.
- ``claimed_at`` — the moment an owner took control. Defaults to insert time
  (``server_default now()``) so every owned-at-creation path stays correct
  without stamping it; the assembly pipeline opts out with an explicit NULL, so
  ``claimed_at IS NULL`` means "assembled, unclaimed". Existing rows backfilled
  to their ``created_at`` (accurate historical value); the default is set
  *after* the backfill so it isn't overwritten with now().

Downgrade re-imposes NOT NULL on ``email`` / ``password_hash`` and will fail if
any unclaimed assembled profile exists — by design, those rows can't satisfy
the old invariant. Claim or delete them before downgrading.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "u7p9r1t3v5x7"
down_revision: Union[str, None] = "t6o8q0s2u4w6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(length=255), nullable=True)
    op.alter_column(
        "users", "password_hash", existing_type=sa.String(length=255), nullable=True
    )
    op.add_column("users", sa.Column("x_handle", sa.String(length=50), nullable=True))
    op.add_column(
        "users", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Name matches Postgres' inline-unique convention (``users_email_key`` /
    # ``users_username_key``) so create_all and migration agree on the schema.
    op.create_unique_constraint("users_x_handle_key", "users", ["x_handle"])
    # Existing rows are all self-registered / seeded — owned at creation — so
    # backfill to their accurate ``created_at``.
    op.execute("UPDATE users SET claimed_at = created_at")
    # Future owned accounts (registration, seeder, mocks, later public sign-up)
    # default to claimed-at-insert; the assembly pipeline opts out by inserting
    # an explicit NULL. Set after the backfill so existing rows keep created_at,
    # not now().
    op.alter_column("users", "claimed_at", server_default=sa.text("now()"))


def downgrade() -> None:
    op.drop_constraint("users_x_handle_key", "users", type_="unique")
    op.drop_column("users", "claimed_at")
    op.drop_column("users", "x_handle")
    op.alter_column(
        "users", "password_hash", existing_type=sa.String(length=255), nullable=False
    )
    op.alter_column("users", "email", existing_type=sa.String(length=255), nullable=False)
