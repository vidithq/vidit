"""geolocation source_date — when the source posted the media

Revision ID: w9r1t3v5x7z9
Revises: v8q0s2u4w6y8
Create Date: 2026-06-24 12:00:00.000000

Adds ``source_date`` to ``geolocations`` — the date the original source (a
Telegram channel, an X account, …) posted the media. Distinct from
``event_date`` (when the depicted event happened) and ``created_at`` (when the
geolocation was submitted to Vidit).

Nullable, no backfill: existing rows have no recoverable source post date, so
NULL is the honest value. The submit form marks it optional.

Downgrade drops the column (always safe).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w9r1t3v5x7z9"
down_revision: Union[str, None] = "v8q0s2u4w6y8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "geolocations",
        sa.Column("source_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("geolocations", "source_date")
