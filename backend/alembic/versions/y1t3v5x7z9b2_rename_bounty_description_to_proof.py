"""rename bounties.description -> bounties.proof

Revision ID: y1t3v5x7z9b2
Revises: x0s2u4w6y8a0
Create Date: 2026-06-24 16:00:00.000000

A bounty is an unfinished geolocation, so its annotated body is a geolocation
``proof`` still in progress, not a free-form "description". Rename the column to
match ``geolocations.proof`` and make the bounty / geolocation harmonisation
structural, not just a UI label. Pure column rename — JSONB type and data are
preserved, no backfill.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "y1t3v5x7z9b2"
down_revision: Union[str, None] = "x0s2u4w6y8a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("bounties", "description", new_column_name="proof")


def downgrade() -> None:
    op.alter_column("bounties", "proof", new_column_name="description")
