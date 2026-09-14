"""add collections and collection_events

Revision ID: q5s7u9w1y3a5
Revises: o3q5s7u9w1y3
Create Date: 2026-09-12 10:00:00.000000

A collection is a named, curated set of one analyst's own events, shown on the
owner's public profile. Two tables carry it: ``collections`` (owner, title,
description, takedown stamp) and ``collection_events`` (the memberships, one
row per event in one collection).

``description`` is ``TEXT`` with no width and NOT NULL: every collection says
what it holds, and the 500-character cap lives in ``schemas/collection``, the
shape ``users.bio`` takes, so moving the cap costs no migration.

Every foreign key cascades. ``collections.owner_id`` does, unlike
``events.owner_id``, because a collection is one analyst's own shelf and
nothing outlives their account, so a GDPR hard delete passes straight through
and leaves no stored object behind, a collection holding no file of its own.
The membership keys cascade on both sides, so neither a hard-deleted event nor
a hard-deleted collection leaves a row pointing at nothing.

The ownership invariant (an event joins its owner's collection only) lives in
``services/collections.add_event``, not here: it spans two tables, which a
CHECK cannot.

``content_reports`` gains ``collection_id`` here, beside the ``event_id`` it
already carries and on the same ``SET NULL`` terms, so one queue answers both
kinds of report. The column lands in this migration because the foreign key
needs ``collections`` to exist, which the statements above create. The CHECK
is ``num_nonnulls(event_id, collection_id) <= 1``, "never both" rather than
"exactly one": a report whose target is hard-deleted has that column set to
NULL, so both-NULL is the orphan state every report can reach and the row has
to stay legal in it. Exactly one is set at insert, which the two report routes
hold by each naming one target.

A GIN index over ``title || ' ' || description`` backs the collections group of
``GET /search``, the shape the baseline migration gives events and users. The
expression has to stay identical to the one ``services/search`` builds, config
name included, or the planner drops the index and scans the table.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "q5s7u9w1y3a5"
down_revision: Union[str, None] = "o3q5s7u9w1y3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The ``title`` column width, mirroring ``models/event.TITLE_MAX_LENGTH``: one
# cap governs an event title and a collection title alike.
TITLE_MAX_LENGTH = 255

# The document the collections search group matches on, reused between this
# index and the runtime query (``services/search._collection_tsvector``):
# Postgres refuses the index for a SELECT whose expression differs. 'simple'
# rather than 'english' for the reason the baseline states, a corpus of place
# names and OSINT identifiers that does not stem cleanly.
_COLLECTION_TSVECTOR = "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))"

# One report names one target. Mirrors the constraint on
# ``models/content_report.ContentReport``; see the module docstring for why the
# test is "never both" rather than "exactly one".
_ONE_TARGET = "num_nonnulls(event_id, collection_id) <= 1"


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=TITLE_MAX_LENGTH), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # "This analyst's collections, newest first", the profile section's read.
    op.create_index(
        "ix_collections_owner_created_at", "collections", ["owner_id", "created_at"]
    )
    # The collections group of `GET /search`: one document per collection, its
    # name and what it says it holds.
    op.execute(
        f"CREATE INDEX ix_collections_search_fts ON collections USING GIN ({_COLLECTION_TSVECTOR})"
    )

    op.create_table(
        "collection_events",
        sa.Column("collection_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("collection_id", "event_id"),
    )
    # The PK's leading ``collection_id`` serves "what is in this collection";
    # this covers the reverse, "which collections hold this event", which the
    # add-to-collection popover and the event page both read.
    op.create_index("ix_collection_events_event_id", "collection_events", ["event_id"])

    # A collection is reportable like an event, through the same table and the
    # same queue.
    op.add_column("content_reports", sa.Column("collection_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_content_reports_collection_id",
        "content_reports",
        "collections",
        ["collection_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # "The reports filed against this collection", which the queue reads when
    # it hydrates a row and an admin reads when judging a shelf.
    op.create_index("ix_content_reports_collection_id", "content_reports", ["collection_id"])
    op.create_check_constraint("ck_content_reports_one_target", "content_reports", _ONE_TARGET)


def downgrade() -> None:
    # The report column first: its foreign key points into ``collections``.
    op.drop_constraint("ck_content_reports_one_target", "content_reports", type_="check")
    op.drop_index("ix_content_reports_collection_id", table_name="content_reports")
    op.drop_constraint("fk_content_reports_collection_id", "content_reports", type_="foreignkey")
    op.drop_column("content_reports", "collection_id")

    # Memberships next: they hold the foreign key into ``collections``.
    op.drop_index("ix_collection_events_event_id", table_name="collection_events")
    op.drop_table("collection_events")
    op.drop_index("ix_collections_search_fts", table_name="collections")
    op.drop_index("ix_collections_owner_created_at", table_name="collections")
    op.drop_table("collections")
