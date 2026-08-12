"""detected_from archival origin

Revision ID: v4x6z8b0d2f4
Revises: u3w5y7a9c1e3
Create Date: 2026-08-12 16:00:00.000000

The post a machine draft was detected from (``events.detected_from_url``) is
provenance the catalog promises to keep readable, and it dies the same way a
source tweet does, so it enters the archival queue at publication alongside the
source and its mirrors. ``ck_source_archives_origin_valid`` pins the origin
domain at the database, so widening the domain is a constraint swap; the check
is recreated rather than altered, which is what Postgres offers.

Downgrade narrows the domain back and deletes the ``detected_from`` rows, since
a row the constraint would reject cannot survive the swap. Only queue entries
are lost: the link itself stays in ``events.detected_from_url``, and on a
re-upgrade the catalog backfill re-enqueues it for every published event, since
its scan selects an event whose provenance link has no matching
``source_archives`` row.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "v4x6z8b0d2f4"
down_revision: Union[str, None] = "u3w5y7a9c1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT = "ck_source_archives_origin_valid"
_TABLE = "source_archives"

# The origin domain on each side of this revision. Named rather than inlined so
# the tests can build the same check on a scratch table and exercise the swap
# without migrating a live database.
ORIGINS_BEFORE: tuple[str, ...] = ("source_url", "secondary_source", "proof_link")
ORIGINS_AFTER: tuple[str, ...] = (
    "source_url",
    "secondary_source",
    "detected_from",
    "proof_link",
)


def origin_check(origins: Sequence[str]) -> str:
    """The check expression pinning ``origin`` to ``origins``."""
    return "origin IN ({})".format(", ".join(f"'{origin}'" for origin in origins))


def drop_widened_rows_sql(table: str) -> str:
    """The statement that clears the rows the narrowed domain would reject."""
    return f"DELETE FROM {table} WHERE origin = 'detected_from'"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, origin_check(ORIGINS_AFTER))


def downgrade() -> None:
    op.execute(drop_widened_rows_sql(_TABLE))
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, origin_check(ORIGINS_BEFORE))
