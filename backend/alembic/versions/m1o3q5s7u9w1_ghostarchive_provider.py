"""admit 'ghostarchive' in source_archives.provider

Revision ID: m1o3q5s7u9w1
Revises: k9m1o3q5s7u9
Create Date: 2026-08-24 10:00:00.000000

Ghostarchive is a third accepted snapshot host, and the provider column is the
discriminator the read surface names a stored copy from, so its domain carries a
third value. The CHECK is dropped and recreated with the widened domain.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "m1o3q5s7u9w1"
down_revision: Union[str, None] = "k9m1o3q5s7u9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT = "ck_source_archives_provider_valid"
TABLE = "source_archives"
WIDENED = "provider IN ('wayback', 'archive_today', 'ghostarchive')"
PREVIOUS = "provider IN ('wayback', 'archive_today')"


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT, TABLE, type_="check")
    op.create_check_constraint(CONSTRAINT, TABLE, WIDENED)


def downgrade() -> None:
    # A ghostarchive row is outside the narrowed domain, and what happens to it
    # is a decision a schema migration has no standing to take: the snapshot is
    # evidence an analyst recorded, so it is neither deleted nor relabelled here.
    # The downgrade refuses and counts the rows instead; an operator who means to
    # remove them says so with their own statement and re-runs this. A catalog
    # holding none downgrades untouched.
    stored = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM source_archives WHERE provider = 'ghostarchive'"))
        .scalar_one()
    )
    if stored:
        raise RuntimeError(
            f"{stored} archived copy/copies are held on ghostarchive, which the narrowed"
            " CHECK forbids. Decide what happens to them (delete the rows) and re-run"
            " this downgrade."
        )
    op.drop_constraint(CONSTRAINT, TABLE, type_="check")
    op.create_check_constraint(CONSTRAINT, TABLE, PREVIOUS)
