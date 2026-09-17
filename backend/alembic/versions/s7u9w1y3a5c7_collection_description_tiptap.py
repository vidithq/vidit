"""collection description becomes a tiptap document

Revision ID: s7u9w1y3a5c7
Revises: q5s7u9w1y3a5
Create Date: 2026-09-17 10:00:00.000000

A collection's description is the same class of body an event's ``proof`` is: a
Tiptap (ProseMirror) document in ``JSONB``, written with bold, italic and
lists. Two columns carry it after this revision.

``description`` holds the document. ``description_text`` holds its plain-text
projection, the string ``services/sanitize.tiptap_doc_text`` builds, so every
surface that needs the description as text (the search index, the card's
two-line clamp, the share card, the 500-character cap) reads one stored value
rather than walking the tree again. The service writes the pair together; a
column holding one without the other is a bug in ``services/collections``.

Images are not part of a description: the write schemas sanitise with
``allow_images=False``, so no description document ever carries an image node
and there is no upload path behind one.

Existing rows carry plain text. The data migration reads each row's text and
builds the document ``sanitize.tiptap_doc_from_text`` builds: one paragraph per
non-blank line, blank lines dropped. The statement below is that rule in SQL,
and it runs on a populated table, so no row is left without a document.

The GIN index behind the collections group of ``GET /search`` is dropped and
recreated over ``description_text``: a ``to_tsvector`` over a ``JSONB`` column
would index the document's punctuation and node names, and the projection is
what a reader typed. The expression has to stay identical to the one
``services/search._collection_tsvector`` builds, config name included, or the
planner drops the index and scans the table.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "s7u9w1y3a5c7"
down_revision: Union[str, None] = "q5s7u9w1y3a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The document the collections search group matches on, reused between this
# index and the runtime query (``services/search._collection_tsvector``):
# Postgres refuses the index for a SELECT whose expression differs. The only
# change from ``q5s7u9w1y3a5`` is the column: the projection rather than the
# document.
_COLLECTION_TSVECTOR = (
    "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description_text, ''))"
)

# The ``q5s7u9w1y3a5`` expression, for the downgrade that restores it.
_COLLECTION_TSVECTOR_TEXT = (
    "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))"
)

# ``sanitize.tiptap_doc_from_text`` in SQL: one paragraph node per non-blank
# line of the stored text, blank lines dropped, and an empty ``content`` array
# for a text that has no line left. ``btrim`` over the ASCII whitespace set is
# the ``str.strip`` the Python side runs.
_DOC_FROM_TEXT = r"""
    UPDATE collections
       SET description_doc = jsonb_build_object(
           'type', 'doc',
           'content', coalesce(
               (SELECT jsonb_agg(
                           jsonb_build_object(
                               'type', 'paragraph',
                               'content', jsonb_build_array(
                                   jsonb_build_object('type', 'text', 'text', line)
                               )
                           )
                       )
                  FROM unnest(string_to_array(description, chr(10))) AS line
                 WHERE btrim(line, E' \t\r\n\f\v') <> ''),
               '[]'::jsonb)
       )
"""


def upgrade() -> None:
    # The index reads ``description``, which changes type below, so it goes
    # first and comes back over the projection at the end.
    op.drop_index("ix_collections_search_fts", table_name="collections")

    # The projection, filled from the text every existing row already holds:
    # flattening that text yields the text itself, one paragraph per line.
    op.add_column("collections", sa.Column("description_text", sa.Text(), nullable=True))
    op.execute("UPDATE collections SET description_text = description")
    op.alter_column("collections", "description_text", nullable=False)

    # The document, built beside the old column and then put in its place. A
    # new column rather than ``ALTER COLUMN ... TYPE ... USING``, whose
    # transform expression may not carry the sub-select the rule needs.
    op.add_column(
        "collections",
        sa.Column("description_doc", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.execute(_DOC_FROM_TEXT)
    op.alter_column("collections", "description_doc", nullable=False)
    op.drop_column("collections", "description")
    op.alter_column("collections", "description_doc", new_column_name="description")

    op.execute(
        f"CREATE INDEX ix_collections_search_fts ON collections USING GIN ({_COLLECTION_TSVECTOR})"
    )


def downgrade() -> None:
    op.drop_index("ix_collections_search_fts", table_name="collections")

    # Flatten back: ``description_text`` is the projection of the document, so
    # restoring the text column from it is the inverse of the walk above.
    op.add_column("collections", sa.Column("description_flat", sa.Text(), nullable=True))
    op.execute("UPDATE collections SET description_flat = description_text")
    op.alter_column("collections", "description_flat", nullable=False)
    op.drop_column("collections", "description")
    op.drop_column("collections", "description_text")
    op.alter_column("collections", "description_flat", new_column_name="description")

    op.execute(
        "CREATE INDEX ix_collections_search_fts ON collections "
        f"USING GIN ({_COLLECTION_TSVECTOR_TEXT})"
    )
