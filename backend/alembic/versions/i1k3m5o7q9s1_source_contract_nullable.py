"""events source contract: nullable source_url + source_posted_at, status-tied CHECK

Revision ID: i1k3m5o7q9s1
Revises: h0j2l4n6p8r0
Create Date: 2026-07-06 00:00:00.000000

The ingest brick no longer fabricates a source: a machine ``detected`` row may
carry no ``source_url`` (the imported tweet neither quoted nor linked footage)
and no ``source_posted_at`` (the source's post time is only known for a dated
quote). Both columns become nullable, and the source requirement moves to the
states that vouch evidence: ``ck_events_source_url_status`` (same motif as
``ck_events_coords_status``) makes ``requested`` / ``geolocated`` imply
``source_url IS NOT NULL``. No data backfill: existing rows all carry values
(the dev catalog is reimported after wipes anyway).

Downgrade restores NOT NULL best-effort: a NULL ``source_url`` falls back to
the row's ``detected_from_url`` provenance link (every NULL-source row is a
machine detection), and a NULL ``source_posted_at`` to ``detected_post_at``
then ``created_at``, the same placeholder ``z2b4d6f8h0j2`` used.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "i1k3m5o7q9s1"
down_revision: Union[str, None] = "h0j2l4n6p8r0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("events", "source_url", existing_type=sa.Text(), nullable=True)
    op.alter_column(
        "events",
        "source_posted_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
    )
    op.create_check_constraint(
        "ck_events_source_url_status",
        "events",
        "status NOT IN ('requested', 'geolocated') OR source_url IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_events_source_url_status", "events", type_="check")
    # Fill the NULLs so NOT NULL can be restored. ``detected_from_url`` is set
    # on every machine row, which is the only cohort that can hold a NULL
    # source; the literal fallback is a belt for hand-edited dev rows.
    op.execute(
        "UPDATE events SET source_url = COALESCE(detected_from_url, 'https://example.invalid/unknown-source') "
        "WHERE source_url IS NULL"
    )
    op.execute(
        "UPDATE events SET source_posted_at = COALESCE(detected_post_at, created_at) "
        "WHERE source_posted_at IS NULL"
    )
    op.alter_column(
        "events",
        "source_posted_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    op.alter_column("events", "source_url", existing_type=sa.Text(), nullable=False)
