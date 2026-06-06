"""add_provenance_to_media_and_proof_images

Revision ID: r4m6n8o0p2q4
Revises: q3l5m7n9o1p3
Create Date: 2026-05-13 14:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import INET

revision: str = "r4m6n8o0p2q4"
down_revision: Union[str, None] = "q3l5m7n9o1p3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Provenance metadata captured at upload time. Adds three columns
    # to both ``media`` and ``proof_images`` so every piece of
    # uploaded evidence carries "who submitted this, from where, and
    # under what filename" without a join through ``auth_events``
    # (which only covers auth-related events and so misses the
    # actual upload moment).
    #
    # All three columns are nullable: existing rows pre-date them and
    # cannot be backfilled from any source we still have. Demo seeder
    # rows (which reference ``demo-pool/`` objects without an upload
    # pass) also carry NULL by design — there's no real submitter to
    # record.
    #
    # ``uploaded_ip`` uses PostgreSQL's native INET type, same as the
    # ``auth_events.ip`` column. INET stores IPv4 and IPv6 in their
    # native sizes (4 / 16 bytes) and rejects malformed values, so a
    # parse-pass in Python (``ipaddress.ip_address``) is required
    # before insert.
    #
    # ``uploaded_user_agent`` is TEXT (nominally unbounded) — the
    # router caps absurdly-long UA strings at 1 KB before insert so
    # one malformed scraper request can't pollute the table.
    #
    # ``original_filename`` is TEXT — visible on the public read API
    # because investigators sometimes need to trace evidence back to a
    # source post by filename. The IP and UA stay admin-only.
    for table in ("media", "proof_images"):
        op.add_column(
            table,
            sa.Column("uploaded_ip", INET(), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("uploaded_user_agent", sa.Text(), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("original_filename", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    for table in ("media", "proof_images"):
        op.drop_column(table, "original_filename")
        op.drop_column(table, "uploaded_user_agent")
        op.drop_column(table, "uploaded_ip")
