"""sites

Revision ID: 1a47ba7bbcb5
Revises: c4e6a8b0d2f3
Create Date: 2026-10-25 08:00:00.000000

A site is a named area of interest that analysts monitor through dated satellite imagery.

* ``sites`` holds the record: owner, name and kind. The owner's edits to the name and the kind
  file the superseded state in ``site_versions``.
* A site image is a ``sources`` row whose owner is the site: ``event_id`` becomes nullable,
  ``site_id`` joins it, and ``ck_sources_one_owner`` keeps exactly one of the two. A site image
  is a ``satellite`` source of level ``context`` with a capture time, and carries its analyst
  (``author_id``) and an optional ``note``, two columns an event's source leaves NULL.
* ``site_contours`` holds every zone the owner drew, each citing the site image that shows it.
* ``event_site_links`` records each period during which an event's author tied the event to a
  site, with the effect the event shows there.
* ``content_reports`` gains ``site_id``, a third report target.

``sites.owner_id`` cascades like ``collections.owner_id``. The analyst columns are
``SET NULL``, so an erased analyst leaves their image, contour or link behind.

The downgrade deletes the site images before ``sources.event_id`` turns NOT NULL again. Their
stored files stay in the bucket.
"""

from typing import Sequence, Union

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "1a47ba7bbcb5"
down_revision: Union[str, None] = "c4e6a8b0d2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mirrors ``models/event.TITLE_MAX_LENGTH``.
TITLE_MAX_LENGTH = 255

# Mirror the ``Literal`` domains in ``models/site``; change both.
_SITE_KINDS = (
    "airbase",
    "military_base",
    "depot",
    "port",
    "air_defence_position",
    "artillery_position",
    "radar",
    "fortification",
    "unknown",
    "other",
)
_LINK_EFFECTS = ("damage", "destruction", "activity", "other")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "sites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=TITLE_MAX_LENGTH), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("version_no", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(_in("kind", _SITE_KINDS), name="ck_sites_kind_valid"),
    )
    op.create_index("ix_sites_owner_id", "sites", ["owner_id"])

    op.create_table(
        "site_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("edited_by_id", sa.Uuid(), nullable=True),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["edited_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "version_no", name="uq_site_versions_site_no"),
    )

    op.alter_column("sources", "event_id", existing_type=sa.Uuid(), nullable=True)
    op.add_column("sources", sa.Column("site_id", sa.Uuid(), nullable=True))
    op.add_column("sources", sa.Column("author_id", sa.Uuid(), nullable=True))
    op.add_column("sources", sa.Column("note", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_sources_site_id", "sources", "sites", ["site_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "fk_sources_author_id",
        "sources",
        "users",
        ["author_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_sources_site_id", "sources", ["site_id"])
    op.create_check_constraint(
        "ck_sources_one_owner", "sources", "num_nonnulls(event_id, site_id) = 1"
    )
    op.create_check_constraint(
        "ck_sources_site_image",
        "sources",
        "site_id IS NULL OR (kind = 'satellite' AND level = 'context' "
        "AND captured_at IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_sources_site_fields",
        "sources",
        "site_id IS NOT NULL OR (author_id IS NULL AND note IS NULL)",
    )

    op.create_table(
        "site_contours",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column(
            "zone",
            geoalchemy2.types.Geometry(
                geometry_type="POLYGON", srid=4326, dimension=2, spatial_index=True
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_site_contours_site_id", "site_contours", ["site_id"])
    op.create_index("ix_site_contours_source_id", "site_contours", ["source_id"])

    op.create_table(
        "event_site_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("effect", sa.String(length=20), nullable=False),
        sa.Column(
            "linked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("linked_by_id", sa.Uuid(), nullable=True),
        sa.Column("unlinked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unlinked_by_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["linked_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["unlinked_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(_in("effect", _LINK_EFFECTS), name="ck_event_site_links_effect_valid"),
    )
    op.create_index(
        "uq_event_site_links_live",
        "event_site_links",
        ["event_id", "site_id"],
        unique=True,
        postgresql_where=sa.text("unlinked_at IS NULL"),
    )
    op.create_index("ix_event_site_links_site_id", "event_site_links", ["site_id"])
    op.create_index("ix_event_site_links_event_id", "event_site_links", ["event_id"])

    op.add_column("content_reports", sa.Column("site_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_content_reports_site_id",
        "content_reports",
        "sites",
        ["site_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_content_reports_site_id", "content_reports", ["site_id"])
    op.drop_constraint("ck_content_reports_one_target", "content_reports", type_="check")
    op.create_check_constraint(
        "ck_content_reports_one_target",
        "content_reports",
        "num_nonnulls(event_id, collection_id, site_id) <= 1",
    )


def downgrade() -> None:
    op.drop_constraint("ck_content_reports_one_target", "content_reports", type_="check")
    op.create_check_constraint(
        "ck_content_reports_one_target",
        "content_reports",
        "num_nonnulls(event_id, collection_id) <= 1",
    )
    op.drop_index("ix_content_reports_site_id", table_name="content_reports")
    op.drop_constraint("fk_content_reports_site_id", "content_reports", type_="foreignkey")
    op.drop_column("content_reports", "site_id")

    op.drop_index("ix_event_site_links_event_id", table_name="event_site_links")
    op.drop_index("ix_event_site_links_site_id", table_name="event_site_links")
    op.drop_index("uq_event_site_links_live", table_name="event_site_links")
    op.drop_table("event_site_links")
    op.drop_index("ix_site_contours_source_id", table_name="site_contours")
    op.drop_index("ix_site_contours_site_id", table_name="site_contours")
    op.drop_table("site_contours")

    op.execute("DELETE FROM sources WHERE site_id IS NOT NULL")
    op.drop_constraint("ck_sources_site_fields", "sources", type_="check")
    op.drop_constraint("ck_sources_site_image", "sources", type_="check")
    op.drop_constraint("ck_sources_one_owner", "sources", type_="check")
    op.drop_index("ix_sources_site_id", table_name="sources")
    op.drop_constraint("fk_sources_author_id", "sources", type_="foreignkey")
    op.drop_constraint("fk_sources_site_id", "sources", type_="foreignkey")
    op.drop_column("sources", "note")
    op.drop_column("sources", "author_id")
    op.drop_column("sources", "site_id")
    op.alter_column("sources", "event_id", existing_type=sa.Uuid(), nullable=False)

    op.drop_table("site_versions")
    op.drop_index("ix_sites_owner_id", table_name="sites")
    op.drop_table("sites")
