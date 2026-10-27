"""site versions hold the full state

Revision ID: 5b8d2e7f9c41
Revises: 1a47ba7bbcb5
Create Date: 2026-10-27 09:00:00.000000

A site version is now the whole state of the site: its name, its kind, and its images, each with
the contour drawn on it.

* ``sources.removed_at`` removes a site image from the live state and keeps its row, so every
  version that names it stays readable. ``ck_sources_site_fields`` keeps it NULL on an event's
  source.
* ``site_contours.superseded_at`` retires a redrawn or dropped contour and keeps its row. A live
  image carries at most one live contour (``uq_site_contours_live_source``): of several contours
  on one image, the latest stays live and each earlier one is superseded when the next was drawn.
* ``site_versions.snapshot`` gains ``images``: each image with ``id`` and ``contour_id``. An
  existing row is rebuilt from the images filed and the contours drawn up to its ``created_at``,
  the moment it was superseded.
* ``event_site_links`` keeps the live links only: an unlinked row is deleted, and the unlink and
  attribution columns go. ``uq_event_site_links_event_site`` replaces the partial index.

The downgrade deletes the removed images and the links' history is not restored.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b8d2e7f9c41"
down_revision: Union[str, None] = "1a47ba7bbcb5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rebuild_snapshots() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, site_id, created_at, snapshot FROM site_versions")
    ).mappings()
    for row in list(rows):
        images = bind.execute(
            sa.text(
                """
                SELECT s.id AS id,
                       (SELECT c.id FROM site_contours c
                         WHERE c.source_id = s.id AND c.created_at <= :at
                         ORDER BY c.created_at DESC, c.id DESC LIMIT 1) AS contour_id
                  FROM sources s
                 WHERE s.site_id = :site_id AND s.created_at <= :at
                 ORDER BY s.captured_at, s.created_at, s.id
                """
            ),
            {"site_id": row["site_id"], "at": row["created_at"]},
        ).mappings()
        snapshot = {
            "name": row["snapshot"]["name"],
            "kind": row["snapshot"]["kind"],
            "images": [
                {
                    "id": str(image["id"]),
                    "contour_id": str(image["contour_id"]) if image["contour_id"] else None,
                }
                for image in images
            ],
        }
        bind.execute(
            sa.text("UPDATE site_versions SET snapshot = CAST(:snapshot AS jsonb) WHERE id = :id"),
            {"snapshot": json.dumps(snapshot), "id": row["id"]},
        )


def upgrade() -> None:
    op.add_column("sources", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))
    op.drop_constraint("ck_sources_site_fields", "sources", type_="check")
    op.create_check_constraint(
        "ck_sources_site_fields",
        "sources",
        "site_id IS NOT NULL OR (author_id IS NULL AND note IS NULL AND removed_at IS NULL)",
    )

    op.add_column(
        "site_contours", sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(
        """
        UPDATE site_contours c
           SET superseded_at = n.next_at
          FROM (SELECT id, LEAD(created_at) OVER (
                         PARTITION BY source_id ORDER BY created_at, id) AS next_at
                  FROM site_contours) n
         WHERE c.id = n.id AND n.next_at IS NOT NULL
        """
    )
    op.create_index(
        "uq_site_contours_live_source",
        "site_contours",
        ["source_id"],
        unique=True,
        postgresql_where=sa.text("superseded_at IS NULL"),
    )

    _rebuild_snapshots()

    op.execute("DELETE FROM event_site_links WHERE unlinked_at IS NOT NULL")
    op.drop_index("uq_event_site_links_live", table_name="event_site_links")
    op.drop_index("ix_event_site_links_event_id", table_name="event_site_links")
    op.drop_column("event_site_links", "unlinked_by_id")
    op.drop_column("event_site_links", "unlinked_at")
    op.drop_column("event_site_links", "linked_by_id")
    op.create_unique_constraint(
        "uq_event_site_links_event_site", "event_site_links", ["event_id", "site_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_event_site_links_event_site", "event_site_links", type_="unique")
    op.add_column("event_site_links", sa.Column("linked_by_id", sa.Uuid(), nullable=True))
    op.add_column(
        "event_site_links", sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("event_site_links", sa.Column("unlinked_by_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "event_site_links_linked_by_id_fkey",
        "event_site_links",
        "users",
        ["linked_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "event_site_links_unlinked_by_id_fkey",
        "event_site_links",
        "users",
        ["unlinked_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_event_site_links_event_id", "event_site_links", ["event_id"])
    op.create_index(
        "uq_event_site_links_live",
        "event_site_links",
        ["event_id", "site_id"],
        unique=True,
        postgresql_where=sa.text("unlinked_at IS NULL"),
    )

    op.execute("UPDATE site_versions SET snapshot = snapshot - 'images'")

    op.drop_index("uq_site_contours_live_source", table_name="site_contours")
    op.drop_column("site_contours", "superseded_at")

    op.execute("DELETE FROM sources WHERE removed_at IS NOT NULL")
    op.drop_constraint("ck_sources_site_fields", "sources", type_="check")
    op.create_check_constraint(
        "ck_sources_site_fields",
        "sources",
        "site_id IS NOT NULL OR (author_id IS NULL AND note IS NULL)",
    )
    op.drop_column("sources", "removed_at")
