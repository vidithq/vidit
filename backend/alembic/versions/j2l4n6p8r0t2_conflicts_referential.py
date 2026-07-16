"""conflicts referential: dedicated table, conflict tags migrated out

Revision ID: j2l4n6p8r0t2
Revises: i1k3m5o7q9s1
Create Date: 2026-07-16 10:00:00.000000

Conflicts stop being ``tags`` rows (``category='conflict'``) and become a
dedicated ``conflicts`` referential fed by the Wikipedia ongoing-conflicts
sync and the one-shot Wikidata historical seed (see
``services/conflict_sync`` and ``scripts/seed_conflicts.py``). Identity for
synced rows is the Wikidata QID, so an editorial rename updates the name in
place instead of forking a duplicate.

This migration:

1. creates ``conflicts`` + the ``event_conflicts`` M2M join,
2. copies every existing ``conflict`` tag into ``conflicts``
   (``source='manual'``, ``ongoing=true``) along with its ``event_tags``
   links, so no event loses its conflict association,
3. deletes the ``conflict`` tag rows (their ``event_tags`` links cascade),
4. seeds the ``Other`` escape conflict so the required selector stays
   satisfiable on a fresh DB (idempotent via ``ON CONFLICT (name)``).

The downgrade recreates the ``conflict`` tag rows from ``conflicts`` rows
that have event links (plus ``Other``), truncating names to the 100-char
``tags.name`` width (``conflicts.name`` is 200), and drops the two tables.
Sync metadata (wikidata_id, years, ongoing) is lost on downgrade by design.
"""

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import insert as pg_insert

revision: str = "j2l4n6p8r0t2"
down_revision: Union[str, None] = "i1k3m5o7q9s1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CONFLICT_ESCAPE_NAME = "Other"

# Lightweight Core handles, self-contained (no app-model import) so a later
# ORM change can't retro-alter this migration.
_tags = sa.table(
    "tags",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String()),
    sa.column("category", sa.String()),
)

_conflicts = sa.table(
    "conflicts",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String()),
    sa.column("ongoing", sa.Boolean()),
    sa.column("source", sa.String()),
)


def upgrade() -> None:
    op.create_table(
        "conflicts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False, unique=True),
        sa.Column("wikidata_id", sa.String(length=20), nullable=True, unique=True),
        sa.Column("start_year", sa.Integer(), nullable=True),
        sa.Column("end_year", sa.Integer(), nullable=True),
        sa.Column("tier", sa.String(length=10), nullable=True),
        sa.Column("ongoing", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
    )
    op.create_table(
        "event_conflicts",
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "conflict_id",
            sa.Uuid(),
            sa.ForeignKey("conflicts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # Move the existing curated list: each conflict tag becomes a manual
    # conflicts row (same id, so the event links copy without a name join).
    op.execute(
        sa.text(
            "INSERT INTO conflicts (id, name, ongoing, source) "
            "SELECT id, name, TRUE, 'manual' FROM tags WHERE category = 'conflict' "
            "ON CONFLICT (name) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO event_conflicts (event_id, conflict_id) "
            "SELECT et.event_id, et.tag_id FROM event_tags et "
            "JOIN tags t ON t.id = et.tag_id AND t.category = 'conflict' "
            "JOIN conflicts c ON c.id = et.tag_id "
            "ON CONFLICT DO NOTHING"
        )
    )
    op.execute(_tags.delete().where(_tags.c.category == "conflict"))

    # The escape value, part of the product taxonomy, ships in code (the
    # real list arrives via the sync + seed writers). Idempotent: the tag
    # migration above may already have carried an ``Other`` over.
    op.execute(
        pg_insert(_conflicts)
        .values(
            [
                {
                    "id": uuid.uuid4(),
                    "name": CONFLICT_ESCAPE_NAME,
                    "ongoing": True,
                    "source": "manual",
                }
            ]
        )
        .on_conflict_do_nothing(index_elements=["name"])
    )


def downgrade() -> None:
    # Best-effort reverse: conflicts referenced by at least one event (plus
    # the escape value) go back to being ``conflict`` tags, keeping the same
    # id so the event links can be recreated. Unreferenced seed/sync rows
    # are dropped with the table.
    op.execute(
        sa.text(
            "INSERT INTO tags (id, name, category) "
            "SELECT c.id, LEFT(c.name, 100), 'conflict' FROM conflicts c "
            "WHERE c.name = :escape "
            "OR EXISTS (SELECT 1 FROM event_conflicts ec WHERE ec.conflict_id = c.id) "
            "ON CONFLICT (name) DO NOTHING"
        ).bindparams(escape=CONFLICT_ESCAPE_NAME)
    )
    op.execute(
        sa.text(
            "INSERT INTO event_tags (event_id, tag_id) "
            "SELECT ec.event_id, ec.conflict_id FROM event_conflicts ec "
            "JOIN tags t ON t.id = ec.conflict_id "
            "ON CONFLICT DO NOTHING"
        )
    )
    op.drop_table("event_conflicts")
    op.drop_table("conflicts")
