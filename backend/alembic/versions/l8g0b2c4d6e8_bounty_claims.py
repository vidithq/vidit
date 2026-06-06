"""bounty_claims — multi-analyst signaling replaces single-claimer column

Revision ID: l8g0b2c4d6e8
Revises: k7f9a1b3c5d7
Create Date: 2026-05-12 14:00:00.000000

Slice 1 modelled "I'm working on this" as a single nullable FK on the
bounty row (``claimed_by_user_id``). The product reality is multi-claim:
geolocation work is collaborative and partly competitive, several
analysts may pull at the same media in parallel and "I'm trying" stays
useful even when others are. So:

- Drop ``bounties.claimed_by_user_id`` and its FK; the ``claimed``
  status loses its meaning as a single-reservation state. The column
  is dropped outright since slice 1 hasn't shipped to prod and no live
  rows could carry data.
- Add ``bounty_claims`` junction table — composite PK
  ``(bounty_id, user_id)`` for idempotency (a user can't double-claim),
  ``created_at`` timestamp for ordering.

The ``claimed`` status is no longer in the application enum (see
``app/models/bounty.py``). The schema doesn't enforce that — the column
is a plain ``VARCHAR(20)`` — so prod can drop the value without a DDL.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "l8g0b2c4d6e8"
down_revision: Union[str, None] = "k7f9a1b3c5d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the single-claimer column. FK constraint name from
    # ``op.create_table`` defaults via SQLAlchemy's naming convention
    # — Postgres autogenerates it. We use the column-drop API which
    # cascades the FK in the same call.
    with op.batch_alter_table("bounties") as batch:
        batch.drop_column("claimed_by_user_id")

    op.create_table(
        "bounty_claims",
        sa.Column("bounty_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bounty_id"], ["bounties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("bounty_id", "user_id"),
    )
    op.create_index(
        "ix_bounty_claims_bounty_id_created_at",
        "bounty_claims",
        ["bounty_id", "created_at"],
    )
    op.create_index("ix_bounty_claims_user_id", "bounty_claims", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_bounty_claims_user_id", table_name="bounty_claims")
    op.drop_index(
        "ix_bounty_claims_bounty_id_created_at", table_name="bounty_claims"
    )
    op.drop_table("bounty_claims")

    op.add_column(
        "bounties",
        sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_bounties_claimed_by_user_id",
        source_table="bounties",
        referent_table="users",
        local_cols=["claimed_by_user_id"],
        remote_cols=["id"],
    )
