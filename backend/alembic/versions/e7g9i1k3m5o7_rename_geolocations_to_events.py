"""rename the geolocations entity to events (names only)

Pure DDL rename with no data or behaviour change: the ``geolocation`` internal
entity becomes ``event``. Renames the ``geolocations`` table to ``events``, the
``geolocation_claims`` / ``geolocation_tags`` association tables to
``event_claims`` / ``event_tags`` (their ``geolocation_id`` column to
``event_id``), the ``media.geolocation_id`` column to ``event_id``, and every
primary key / foreign key / index / check constraint named after the old entity
to its ``event`` equivalent. Exact current object names were read off the live
schema.

``proof_images.geolocation_id`` is deliberately left untouched (column, its
indexes, and its foreign-key object keep their names); only the table it points
at is renamed, which Postgres tracks through the ``ALTER TABLE ... RENAME``
transparently.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "e7g9i1k3m5o7"
down_revision: Union[str, None] = "d6f8h0j2l4n6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tables.
    op.execute("ALTER TABLE geolocations RENAME TO events")
    op.execute("ALTER TABLE geolocation_claims RENAME TO event_claims")
    op.execute("ALTER TABLE geolocation_tags RENAME TO event_tags")

    # Association-table + media owner columns.
    op.execute("ALTER TABLE event_claims RENAME COLUMN geolocation_id TO event_id")
    op.execute("ALTER TABLE event_tags RENAME COLUMN geolocation_id TO event_id")
    op.execute("ALTER TABLE media RENAME COLUMN geolocation_id TO event_id")

    # Primary keys.
    op.execute("ALTER INDEX geolocations_pkey RENAME TO events_pkey")
    op.execute("ALTER INDEX geolocation_claims_pkey RENAME TO event_claims_pkey")
    op.execute("ALTER INDEX geolocation_tags_pkey RENAME TO event_tags_pkey")

    # Foreign-key constraints.
    op.execute(
        "ALTER TABLE events RENAME CONSTRAINT geolocations_author_id_fkey "
        "TO events_author_id_fkey"
    )
    op.execute(
        "ALTER TABLE events RENAME CONSTRAINT geolocations_requested_by_id_fkey "
        "TO events_requested_by_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_claims RENAME CONSTRAINT geolocation_claims_geolocation_id_fkey "
        "TO event_claims_event_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_claims RENAME CONSTRAINT geolocation_claims_user_id_fkey "
        "TO event_claims_user_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_tags RENAME CONSTRAINT geolocation_tags_geolocation_id_fkey "
        "TO event_tags_event_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_tags RENAME CONSTRAINT geolocation_tags_tag_id_fkey "
        "TO event_tags_tag_id_fkey"
    )
    op.execute(
        "ALTER TABLE media RENAME CONSTRAINT media_geolocation_id_fkey TO media_event_id_fkey"
    )

    # Check constraint.
    op.execute(
        "ALTER TABLE events RENAME CONSTRAINT ck_geolocations_location_status "
        "TO ck_events_location_status"
    )

    # Indexes on the events table.
    op.execute("ALTER INDEX idx_geolocations_location RENAME TO idx_events_location")
    op.execute("ALTER INDEX ix_geolocations_author_created RENAME TO ix_events_author_created")
    op.execute("ALTER INDEX ix_geolocations_author_id RENAME TO ix_events_author_id")
    op.execute("ALTER INDEX ix_geolocations_created_at RENAME TO ix_events_created_at")
    op.execute("ALTER INDEX ix_geolocations_demo RENAME TO ix_events_demo")
    op.execute(
        "ALTER INDEX ix_geolocations_detected_from_url RENAME TO ix_events_detected_from_url"
    )
    op.execute("ALTER INDEX ix_geolocations_event_date RENAME TO ix_events_event_date")
    op.execute("ALTER INDEX ix_geolocations_live RENAME TO ix_events_live")
    op.execute("ALTER INDEX ix_geolocations_search_fts RENAME TO ix_events_search_fts")
    op.execute(
        "ALTER INDEX ix_geolocations_status_created_at RENAME TO ix_events_status_created_at"
    )

    # Indexes on the event_claims table.
    op.execute(
        "ALTER INDEX ix_geolocation_claims_geolocation_id_created_at "
        "RENAME TO ix_event_claims_event_id_created_at"
    )
    op.execute("ALTER INDEX ix_geolocation_claims_user_id RENAME TO ix_event_claims_user_id")

    # Index on the media table.
    op.execute("ALTER INDEX ix_media_geolocation_id RENAME TO ix_media_event_id")


def downgrade() -> None:
    # Index on the media table.
    op.execute("ALTER INDEX ix_media_event_id RENAME TO ix_media_geolocation_id")

    # Indexes on the event_claims table.
    op.execute("ALTER INDEX ix_event_claims_user_id RENAME TO ix_geolocation_claims_user_id")
    op.execute(
        "ALTER INDEX ix_event_claims_event_id_created_at "
        "RENAME TO ix_geolocation_claims_geolocation_id_created_at"
    )

    # Indexes on the events table.
    op.execute(
        "ALTER INDEX ix_events_status_created_at RENAME TO ix_geolocations_status_created_at"
    )
    op.execute("ALTER INDEX ix_events_search_fts RENAME TO ix_geolocations_search_fts")
    op.execute("ALTER INDEX ix_events_live RENAME TO ix_geolocations_live")
    op.execute("ALTER INDEX ix_events_event_date RENAME TO ix_geolocations_event_date")
    op.execute(
        "ALTER INDEX ix_events_detected_from_url RENAME TO ix_geolocations_detected_from_url"
    )
    op.execute("ALTER INDEX ix_events_demo RENAME TO ix_geolocations_demo")
    op.execute("ALTER INDEX ix_events_created_at RENAME TO ix_geolocations_created_at")
    op.execute("ALTER INDEX ix_events_author_id RENAME TO ix_geolocations_author_id")
    op.execute("ALTER INDEX ix_events_author_created RENAME TO ix_geolocations_author_created")
    op.execute("ALTER INDEX idx_events_location RENAME TO idx_geolocations_location")

    # Check constraint.
    op.execute(
        "ALTER TABLE events RENAME CONSTRAINT ck_events_location_status "
        "TO ck_geolocations_location_status"
    )

    # Foreign-key constraints.
    op.execute(
        "ALTER TABLE media RENAME CONSTRAINT media_event_id_fkey TO media_geolocation_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_tags RENAME CONSTRAINT event_tags_tag_id_fkey "
        "TO geolocation_tags_tag_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_tags RENAME CONSTRAINT event_tags_event_id_fkey "
        "TO geolocation_tags_geolocation_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_claims RENAME CONSTRAINT event_claims_user_id_fkey "
        "TO geolocation_claims_user_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_claims RENAME CONSTRAINT event_claims_event_id_fkey "
        "TO geolocation_claims_geolocation_id_fkey"
    )
    op.execute(
        "ALTER TABLE events RENAME CONSTRAINT events_requested_by_id_fkey "
        "TO geolocations_requested_by_id_fkey"
    )
    op.execute(
        "ALTER TABLE events RENAME CONSTRAINT events_author_id_fkey "
        "TO geolocations_author_id_fkey"
    )

    # Primary keys.
    op.execute("ALTER INDEX event_tags_pkey RENAME TO geolocation_tags_pkey")
    op.execute("ALTER INDEX event_claims_pkey RENAME TO geolocation_claims_pkey")
    op.execute("ALTER INDEX events_pkey RENAME TO geolocations_pkey")

    # Association-table + media owner columns.
    op.execute("ALTER TABLE media RENAME COLUMN event_id TO geolocation_id")
    op.execute("ALTER TABLE event_tags RENAME COLUMN event_id TO geolocation_id")
    op.execute("ALTER TABLE event_claims RENAME COLUMN event_id TO geolocation_id")

    # Tables.
    op.execute("ALTER TABLE event_tags RENAME TO geolocation_tags")
    op.execute("ALTER TABLE event_claims RENAME TO geolocation_claims")
    op.execute("ALTER TABLE events RENAME TO geolocations")
