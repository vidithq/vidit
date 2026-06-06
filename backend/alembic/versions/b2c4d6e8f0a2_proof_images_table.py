"""proof_images_table

Revision ID: b2c4d6e8f0a2
Revises: a1b2c3d4e5f6
Create Date: 2026-05-06 12:00:00.000000

Tracks inline images uploaded from the proof Tiptap editor. Inserted on
upload with geolocation_id NULL; updated on geolocation submit; cascade-
deleted with the geolocation. Orphaned rows (NULL geolocation_id past a
grace period) are reaped by a periodic job.

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b2c4d6e8f0a2"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "proof_images",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("s3_key", sa.Text(), nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "geolocation_id",
            sa.Uuid(),
            sa.ForeignKey("geolocations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.UniqueConstraint("s3_key", name="uq_proof_images_s3_key"),
    )
    op.create_index("ix_proof_images_user_id", "proof_images", ["user_id"])
    op.create_index(
        "ix_proof_images_geolocation_id", "proof_images", ["geolocation_id"]
    )
    op.create_index(
        "ix_proof_images_orphans_created_at",
        "proof_images",
        ["created_at"],
        postgresql_where=sa.text("geolocation_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_proof_images_orphans_created_at", table_name="proof_images")
    op.drop_index("ix_proof_images_geolocation_id", table_name="proof_images")
    op.drop_index("ix_proof_images_user_id", table_name="proof_images")
    op.drop_table("proof_images")
