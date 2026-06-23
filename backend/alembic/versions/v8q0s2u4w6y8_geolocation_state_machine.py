"""geolocation state machine — detected vs validated

Revision ID: v8q0s2u4w6y8
Revises: u7p9r1t3v5x7
Create Date: 2026-06-23 12:00:00.000000

Adds the machine-detection lifecycle to ``geolocations``:

- ``state`` — ``validated`` (human submits + bounty fulfilments, immutable) vs
  ``detected`` (machine-produced, visible-but-marked). Plain string, no DB enum
  (mirrors ``bounties.status``), ``server_default 'validated'`` so every existing
  path stays correct with zero code change; only the machine path sets
  ``detected`` explicitly.
- ``detected_from_url`` — the post a detection was imported from: the
  ``(detected_from_url, coordinate)`` idempotency anchor + provenance link,
  distinct from ``source_url`` (the footage origin). Nullable — human rows have
  none.
- ``proof`` becomes NOT NULL — every row carries a proof document; the machine
  supplies the tweet / thread text. Existing NULL proofs (a real submission can
  land proof-less today) are backfilled to an empty Tiptap doc *first*, then the
  constraint is enforced — a bare ``SET NOT NULL`` would fail otherwise.

No index on ``state``: nothing filters on it yet (the read surfaces only render
it), and a migration-only index is a known autogenerate footgun — declare one in
the model's ``__table_args__`` if a filter ever needs it.

Downgrade drops both columns and relaxes ``proof`` back to nullable (always safe).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "v8q0s2u4w6y8"
down_revision: Union[str, None] = "u7p9r1t3v5x7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Empty Tiptap document — renders cleanly through the proof renderer, so a
# backfilled row reads as "no proof body" rather than a shape the frontend
# doesn't expect.
_EMPTY_TIPTAP_DOC = '{"type": "doc", "content": []}'


def upgrade() -> None:
    op.add_column(
        "geolocations",
        sa.Column(
            "state", sa.String(length=20), nullable=False, server_default="validated"
        ),
    )
    op.add_column(
        "geolocations",
        sa.Column("detected_from_url", sa.Text(), nullable=True),
    )
    op.execute(
        f"UPDATE geolocations SET proof = '{_EMPTY_TIPTAP_DOC}'::jsonb WHERE proof IS NULL"
    )
    op.alter_column(
        "geolocations", "proof", existing_type=postgresql.JSONB(), nullable=False
    )


def downgrade() -> None:
    op.alter_column(
        "geolocations", "proof", existing_type=postgresql.JSONB(), nullable=True
    )
    op.drop_column("geolocations", "detected_from_url")
    op.drop_column("geolocations", "state")
