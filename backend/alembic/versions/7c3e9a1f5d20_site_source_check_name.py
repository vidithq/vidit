"""rename the site source check

Revision ID: 7c3e9a1f5d20
Revises: 5b8d2e7f9c41
Create Date: 2026-10-27 12:00:00.000000

``ck_sources_site_image`` becomes ``ck_sources_site_capture``: a site source is a dated
satellite capture. The condition is unchanged.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c3e9a1f5d20"
down_revision: Union[str, None] = "5b8d2e7f9c41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE sources RENAME CONSTRAINT ck_sources_site_image TO ck_sources_site_capture")


def downgrade() -> None:
    op.execute("ALTER TABLE sources RENAME CONSTRAINT ck_sources_site_capture TO ck_sources_site_image")
