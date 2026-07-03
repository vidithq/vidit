"""rename proof_images.geolocation_id to event_id

Completes the geolocation -> event internal rename. The merge left
``proof_images.geolocation_id`` in place: only its foreign-key *target* table
was renamed geolocations -> events, which Postgres tracked transparently. This
renames the column itself, its FK constraint, and its dedicated index to the
``event`` vocabulary. The partial orphan index ``ix_proof_images_orphans_created_at``
keeps its purpose-based name; its ``WHERE ... IS NULL`` predicate follows the
column rename automatically. Pure DDL, no data or behaviour change. Exact
current object names were read off the live schema.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "g9i1k3m5o7q9"
down_revision: Union[str, None] = "f8h0j2l4n6p8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE proof_images RENAME COLUMN geolocation_id TO event_id")
    op.execute(
        "ALTER TABLE proof_images RENAME CONSTRAINT proof_images_geolocation_id_fkey "
        "TO proof_images_event_id_fkey"
    )
    op.execute("ALTER INDEX ix_proof_images_geolocation_id RENAME TO ix_proof_images_event_id")


def downgrade() -> None:
    op.execute("ALTER INDEX ix_proof_images_event_id RENAME TO ix_proof_images_geolocation_id")
    op.execute(
        "ALTER TABLE proof_images RENAME CONSTRAINT proof_images_event_id_fkey "
        "TO proof_images_geolocation_id_fkey"
    )
    op.execute("ALTER TABLE proof_images RENAME COLUMN event_id TO geolocation_id")
