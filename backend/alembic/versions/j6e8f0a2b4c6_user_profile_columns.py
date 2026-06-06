"""user profile columns — bio, avatar_url, external_links

Revision ID: j6e8f0a2b4c6
Revises: i5d7f9a1b3c5
Create Date: 2026-05-12 09:00:00.000000

Editable profile primitives for analysts. ``bio`` and ``avatar_url``
are nullable TEXT (no value = no card / fallback icon). ``external_links``
is a JSONB object keyed by platform (x, discord, website, github);
defaults to ``{}`` so the read path always finds a dict and the union
in ``UserProfile`` is just "fields the user filled in".

Identity / credibility signalling stays on the existing ``is_trusted``
+ ``trust_reason`` columns (the orange checkmark). No second
verification axis — the trust mark with a public substantiation note
already covers "this is a credible analyst / a known reference
account".
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "j6e8f0a2b4c6"
down_revision: Union[str, None] = "i5d7f9a1b3c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("avatar_url", sa.Text(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "external_links",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "external_links")
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "bio")
