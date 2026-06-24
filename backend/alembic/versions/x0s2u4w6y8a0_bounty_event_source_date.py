"""bounty event_date + source_date — optional dates carried into the geoloc

Revision ID: x0s2u4w6y8a0
Revises: w9r1t3v5x7z9
Create Date: 2026-06-24 13:00:00.000000

A bounty is an unfinished geolocation, so it now carries the same two optional
dates: ``event_date`` (when the depicted event happened) and ``source_date``
(when the source posted the media). Both nullable, no backfill.

Downgrade drops both columns (always safe).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "x0s2u4w6y8a0"
down_revision: Union[str, None] = "w9r1t3v5x7z9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bounties", sa.Column("event_date", sa.Date(), nullable=True))
    op.add_column("bounties", sa.Column("source_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("bounties", "source_date")
    op.drop_column("bounties", "event_date")
