"""add_sha256_to_media_and_proof_images

Revision ID: q3l5m7n9o1p3
Revises: p2k4l6m8n0o2
Create Date: 2026-05-13 12:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q3l5m7n9o1p3"
down_revision: Union[str, None] = "p2k4l6m8n0o2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Hex-encoded SHA-256 — always exactly 64 chars when populated.
    # Nullable because (a) every existing row pre-dates this column and
    # cannot be back-filled without re-reading the bytes from S3 (a
    # one-shot operation, not part of this migration), and (b) the demo
    # seeder mints rows that reference ``demo-pool/`` objects without
    # an upload pass, so they legitimately have no hash to record.
    op.add_column(
        "media",
        sa.Column("sha256", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "proof_images",
        sa.Column("sha256", sa.String(length=64), nullable=True),
    )

    # Partial indexes on the populated cohort. Lets the admin / auditor
    # ask "find every row with this hash" cheaply without taking the
    # index hit on demo / pre-existing rows that carry NULL.
    op.create_index(
        "ix_media_sha256",
        "media",
        ["sha256"],
        unique=False,
        postgresql_where=sa.text("sha256 IS NOT NULL"),
    )
    op.create_index(
        "ix_proof_images_sha256",
        "proof_images",
        ["sha256"],
        unique=False,
        postgresql_where=sa.text("sha256 IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_proof_images_sha256", table_name="proof_images")
    op.drop_index("ix_media_sha256", table_name="media")
    op.drop_column("proof_images", "sha256")
    op.drop_column("media", "sha256")
