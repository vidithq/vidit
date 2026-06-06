"""add_missing_indexes

Revision ID: faac60e89c44
Revises: df0d3ce16843
Create Date: 2026-03-29 17:31:52.997049

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'faac60e89c44'
down_revision: Union[str, None] = 'df0d3ce16843'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Foreign key index — used by profile, author filter, cascade deletes
    op.create_index("ix_geolocations_author_id", "geolocations", ["author_id"])

    # Date indexes — used for filtering and ordering
    op.create_index("ix_geolocations_event_date", "geolocations", ["event_date"])
    op.create_index("ix_geolocations_created_at", "geolocations", ["created_at"])

    # Composite index — user profile page: "my geolocations, newest first"
    op.create_index(
        "ix_geolocations_author_created",
        "geolocations",
        ["author_id", sa.text("created_at DESC")],
    )

    # Media foreign key — used when loading geolocation detail
    op.create_index("ix_media_geolocation_id", "media", ["geolocation_id"])


def downgrade() -> None:
    op.drop_index("ix_media_geolocation_id", table_name="media")
    op.drop_index("ix_geolocations_author_created", table_name="geolocations")
    op.drop_index("ix_geolocations_created_at", table_name="geolocations")
    op.drop_index("ix_geolocations_event_date", table_name="geolocations")
    op.drop_index("ix_geolocations_author_id", table_name="geolocations")
