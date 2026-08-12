"""secondary_source archival origin

Revision ID: t2v4x6z8b0d2
Revises: s1u3w5y7a9c1
Create Date: 2026-08-12 09:00:00.000000

An event's secondary source links (``event_source_links``) are evidence with
the same link-rot risk as the primary ``source_url``, so they enter the
archival queue too. ``ck_source_archives_origin_valid`` pins the origin domain
at the database, so widening the domain is a constraint swap; the check is
recreated rather than altered, which is what Postgres offers.

Downgrade narrows the domain back and deletes the ``secondary_source`` rows,
since a row the constraint would reject cannot survive the swap. Only queue
entries are lost: the links themselves stay in ``event_source_links``, and on
a re-upgrade the catalog backfill re-enqueues them for every published event,
since its scan selects an event holding a secondary link with no matching
``source_archives`` row. An unpublished ``detected`` draft is not swept (the
backfill is published-only); its own promotion enqueues them instead.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "t2v4x6z8b0d2"
down_revision: Union[str, None] = "s1u3w5y7a9c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONSTRAINT = "ck_source_archives_origin_valid"
_TABLE = "source_archives"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "origin IN ('source_url', 'secondary_source', 'proof_link')",
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM {_TABLE} WHERE origin = 'secondary_source'")
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "origin IN ('source_url', 'proof_link')",
    )
