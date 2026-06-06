"""bounties — bounty + bounty_tags + media polymorphism + geolocation trace

Revision ID: k7f9a1b3c5d7
Revises: j6e8f0a2b4c6
Create Date: 2026-05-12 12:00:00.000000

Models the "unfinished geolocation" workflow: an analyst posts media +
source they couldn't place, another analyst picks it up and submits a
real geolocation from it. The slice-1 migration provisions the persistent
shape; the lock-and-submit flow that flips the bounty to ``fulfilled``
arrives in a follow-up.

Schema moves:
- ``bounties`` — title + source_url + Tiptap description + status + tags.
  ``status`` defaults to ``open``; lifecycle transitions live behind the
  forthcoming PATCH endpoint.
- ``bounty_tags`` — junction mirroring ``geolocation_tags``.
- ``media.geolocation_id`` → nullable; new nullable ``media.bounty_id``;
  XOR check ``ck_media_exactly_one_owner`` enforces that every row points
  to exactly one parent. All existing rows hold ``geolocation_id NOT NULL``
  + ``bounty_id NULL`` so the check holds without backfill.
- ``geolocations.originated_from_bounty_id`` — nullable trace to the
  bounty a geolocation was promoted from. ``ON DELETE SET NULL`` so a
  hard-deleted bounty doesn't take its descendant geolocation with it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "k7f9a1b3c5d7"
down_revision: Union[str, None] = "j6e8f0a2b4c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bounties",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("description", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'open'"),
        ),
        sa.Column("claimed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["claimed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bounties_status_created_at", "bounties", ["status", "created_at"]
    )
    op.create_index("ix_bounties_author_id", "bounties", ["author_id"])
    op.create_index("ix_bounties_deleted_at", "bounties", ["deleted_at"])

    op.create_table(
        "bounty_tags",
        sa.Column("bounty_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["bounty_id"], ["bounties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("bounty_id", "tag_id"),
    )

    # Geolocation back-reference (the trace lives here, not on the bounty).
    op.add_column(
        "geolocations",
        sa.Column("originated_from_bounty_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_geolocations_originated_from_bounty_id",
        source_table="geolocations",
        referent_table="bounties",
        local_cols=["originated_from_bounty_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_geolocations_originated_from_bounty_id",
        "geolocations",
        ["originated_from_bounty_id"],
    )

    # Media polymorphism — geolocation_id becomes nullable, bounty_id
    # joins it, XOR enforced at the DB layer.
    op.alter_column("media", "geolocation_id", nullable=True)
    op.add_column("media", sa.Column("bounty_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_media_bounty_id",
        source_table="media",
        referent_table="bounties",
        local_cols=["bounty_id"],
        remote_cols=["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_media_exactly_one_owner",
        "media",
        "(geolocation_id IS NOT NULL AND bounty_id IS NULL) "
        "OR (geolocation_id IS NULL AND bounty_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_media_exactly_one_owner", "media", type_="check")
    op.drop_constraint("fk_media_bounty_id", "media", type_="foreignkey")
    op.drop_column("media", "bounty_id")
    op.alter_column("media", "geolocation_id", nullable=False)

    op.drop_index(
        "ix_geolocations_originated_from_bounty_id",
        table_name="geolocations",
    )
    op.drop_constraint(
        "fk_geolocations_originated_from_bounty_id",
        "geolocations",
        type_="foreignkey",
    )
    op.drop_column("geolocations", "originated_from_bounty_id")

    op.drop_table("bounty_tags")
    op.drop_index("ix_bounties_deleted_at", table_name="bounties")
    op.drop_index("ix_bounties_author_id", table_name="bounties")
    op.drop_index("ix_bounties_status_created_at", table_name="bounties")
    op.drop_table("bounties")
