"""geolocation + bounty temporal precision

Revision ID: z2b4d6f8h0j2
Revises: y1t3v5x7z9b2
Create Date: 2026-06-27 13:00:00.000000

Gives the editorial date fields a time-of-day, and turns the source date into a
real post instant. On both ``geolocations`` and ``bounties``:

* add ``event_time`` (TIME, nullable) — optional hour for ``event_date``; NULL
  when the event's time-of-day is unknown.
* ``source_date`` (DATE, nullable) becomes ``source_posted_at``
  (TIMESTAMPTZ, NOT NULL): a post always has a time. Existing day-only values
  are read as ``00:00 UTC``; pre-existing NULLs are backfilled from
  ``created_at`` (a visible placeholder — the closed-beta catalog is wiped in
  v0.4). The submit/edit forms then always supply a real timestamp.

And on ``geolocations`` only:

* add ``detected_post_at`` (TIMESTAMPTZ, nullable) — when the analyst published
  the geolocation on X (the imported tweet's time); NULL for human submits. The
  precedence signal for the v0.5 claim/dispute pipeline.

Downgrade narrows ``source_posted_at`` back to a nullable DATE (losing the time)
and drops the added columns.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z2b4d6f8h0j2"
down_revision: Union[str, None] = "y1t3v5x7z9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _widen_source_date(table: str) -> None:
    """``source_date`` (DATE, null) → ``source_posted_at`` (TIMESTAMPTZ, NOT NULL)."""
    # Read the bare date as midnight UTC, not midnight in the server's session
    # zone, so the stored instant is deterministic regardless of where alembic runs.
    op.alter_column(
        table,
        "source_date",
        type_=sa.DateTime(timezone=True),
        existing_type=sa.Date(),
        postgresql_using="source_date::timestamp AT TIME ZONE 'UTC'",
        existing_nullable=True,
    )
    # Pre-existing rows with no source date: fall back to the submission instant
    # so the NOT NULL holds. A placeholder, not a real source time.
    op.execute(f"UPDATE {table} SET source_date = created_at WHERE source_date IS NULL")
    op.alter_column(table, "source_date", nullable=False, existing_type=sa.DateTime(timezone=True))
    op.alter_column(
        table,
        "source_date",
        new_column_name="source_posted_at",
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=False,
    )


def _narrow_source_posted_at(table: str) -> None:
    """Reverse: ``source_posted_at`` (TIMESTAMPTZ, NOT NULL) → ``source_date`` (DATE, null)."""
    op.alter_column(
        table,
        "source_posted_at",
        new_column_name="source_date",
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=False,
    )
    op.alter_column(
        table,
        "source_date",
        type_=sa.Date(),
        existing_type=sa.DateTime(timezone=True),
        postgresql_using="source_date::date",
        nullable=True,
        existing_nullable=False,
    )


def upgrade() -> None:
    op.add_column("geolocations", sa.Column("event_time", sa.Time(), nullable=True))
    op.add_column(
        "geolocations",
        sa.Column("detected_post_at", sa.DateTime(timezone=True), nullable=True),
    )
    _widen_source_date("geolocations")

    op.add_column("bounties", sa.Column("event_time", sa.Time(), nullable=True))
    _widen_source_date("bounties")


def downgrade() -> None:
    _narrow_source_posted_at("bounties")
    op.drop_column("bounties", "event_time")

    _narrow_source_posted_at("geolocations")
    op.drop_column("geolocations", "detected_post_at")
    op.drop_column("geolocations", "event_time")
