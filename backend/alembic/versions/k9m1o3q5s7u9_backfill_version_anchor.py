"""backfill source_url + source_media on existing event_versions snapshots

Revision ID: k9m1o3q5s7u9
Revises: i7k9m1o3q5s7
Create Date: 2026-08-19 19:00:00.000000

A snapshot filed before the evidence anchor became editable carries neither
``source_url`` nor ``source_media``, so a reader of an old version has nothing
to render the anchor from and a changed-field list has nothing to compare. The
anchor could not move at the time those versions were filed, so the live row's
source URL and ``role='source'`` media are what every one of them rested on:
this copies that pair onto each of them, in the shape
``services/versions.build_snapshot`` writes, and the history reads the snapshot
alone from then on.

Redacted versions are skipped: their content is blanked on purpose, and writing
an anchor back into one would restore part of what the redaction removed. A
snapshot that already names ``source_url`` is skipped too, so a re-run changes
nothing.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k9m1o3q5s7u9"
down_revision: Union[str, None] = "i7k9m1o3q5s7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ``jsonb_exists`` rather than the ``?`` operator: the statement travels through
# the DBAPI, where a bare ``?`` is ambiguous with a parameter marker.
BACKFILL = """
UPDATE event_versions v
SET snapshot = v.snapshot
    || jsonb_build_object(
        'source_url', to_jsonb(e.source_url),
        'source_media', COALESCE(m.entries, '[]'::jsonb)
    )
FROM events e
LEFT JOIN LATERAL (
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', media.id::text,
            'role', media.role,
            'storage_url', media.storage_url,
            'media_type', media.media_type,
            'sha256', media.sha256,
            'original_filename', media.original_filename
        )
        ORDER BY media.created_at, media.id
    ) AS entries
    FROM media
    WHERE media.event_id = e.id AND media.role = 'source'
) m ON TRUE
WHERE v.event_id = e.id
  AND v.redacted_at IS NULL
  AND NOT jsonb_exists(v.snapshot, 'source_url')
"""


def upgrade() -> None:
    op.execute(BACKFILL)


def downgrade() -> None:
    """No-op: the keys stay.

    Stripping them would take the anchor off every version filed while it was
    editable, which is the one record of what a corrected claim rested on. On a
    version this migration filled, the value equals the live row's, which is
    exactly what the earlier reader fell back to.
    """
