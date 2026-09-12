"""add collections and collection_events

Revision ID: q5s7u9w1y3a5
Revises: o3q5s7u9w1y3
Create Date: 2026-09-12 10:00:00.000000

A collection is a named, curated set of one analyst's own events, shown on the
owner's public profile. Two tables carry it: ``collections`` (owner, title,
cover key, takedown stamp) and ``collection_events`` (the memberships, one row
per event in one collection).

Every foreign key cascades. ``collections.owner_id`` does, unlike
``events.owner_id``, because a collection is one analyst's own shelf and
nothing outlives their account, so a GDPR hard delete passes straight through;
the cover objects are swept by the application before the row goes
(``services/admin.hard_delete_user``). The membership keys cascade on both
sides, so neither a hard-deleted event nor a hard-deleted collection leaves a
row pointing at nothing.

The ownership invariant (an event joins its owner's collection only) lives in
``services/collections.add_event``, not here: it spans two tables, which a
CHECK cannot.
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


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=TITLE_MAX_LENGTH), nullable=False),
        sa.Column("cover_key", sa.Text(), nullable=True),
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


def downgrade() -> None:
    # Memberships first: they hold the foreign key into ``collections``.
    op.drop_index("ix_collection_events_event_id", table_name="collection_events")
    op.drop_table("collection_events")
    op.drop_index("ix_collections_owner_created_at", table_name="collections")
    op.drop_table("collections")
