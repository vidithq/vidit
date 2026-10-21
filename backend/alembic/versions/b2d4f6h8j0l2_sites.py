"""add sites, site_observations and event_site_links

Revision ID: b2d4f6h8j0l2
Revises: 361664db5722
Create Date: 2026-10-20 10:00:00.000000

A site is a named, typed place. Its zone lives on ``site_observations``, one
dated polygon per row, so a site that grows keeps every earlier zone and a read
picks the one valid on a date. ``event_site_links`` records each period
during which an event's owner tied the event to a site, with the effect the
event had on it. Nothing about a site is overwritten or deleted: observations
and links are append-only, and a site's name and type do not change.

``sites.owner_id`` cascades like ``collections.owner_id``: the record goes with
its creator's account. ``site_observations.author_id`` is ``SET NULL`` so an
erased contributor leaves their dated zone behind, and the link actor columns
follow the same rule. The link keys cascade on both sides.

``site_observations.zone`` keeps GeoAlchemy2's default GIST index, created with
the table as ``idx_site_observations_zone``.
"""

from typing import Sequence, Union

import geoalchemy2
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4f6h8j0l2"
down_revision: Union[str, None] = "361664db5722"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mirrors ``models/event.TITLE_MAX_LENGTH``.
TITLE_MAX_LENGTH = 255

# Mirror the ``Literal`` domains in ``models/site``; change both.
_SITE_TYPES = (
    "airbase",
    "military_base",
    "depot",
    "port",
    "air_defence_position",
    "artillery_position",
    "radar",
    "fortification",
    "other",
)
_IMAGERY_PROVIDERS = ("google_earth", "sentinel_2", "landsat", "other")
_OBSERVATION_EFFECTS = (
    "observed_no_change",
    "construction_extension",
    "no_visible_activity",
    "reoccupation",
    "other",
)
_LINK_EFFECTS = ("damage", "destruction", "other")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "sites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=TITLE_MAX_LENGTH), nullable=False),
        sa.Column("site_type", sa.String(length=30), nullable=False),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(_in("site_type", _SITE_TYPES), name="ck_sites_site_type_valid"),
    )
    op.create_index("ix_sites_owner_id", "sites", ["owner_id"])

    op.create_table(
        "site_observations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column(
            "zone",
            geoalchemy2.types.Geometry(
                geometry_type="POLYGON", srid=4326, dimension=2, spatial_index=True
            ),
            nullable=False,
        ),
        sa.Column("captured_on", sa.Date(), nullable=False),
        sa.Column("imagery_provider", sa.String(length=20), nullable=False),
        sa.Column("imagery_url", sa.Text(), nullable=True),
        sa.Column("effect", sa.String(length=30), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            _in("imagery_provider", _IMAGERY_PROVIDERS),
            name="ck_site_observations_imagery_provider_valid",
        ),
        sa.CheckConstraint(
            _in("effect", _OBSERVATION_EFFECTS), name="ck_site_observations_effect_valid"
        ),
        sa.CheckConstraint(
            "imagery_provider <> 'other' OR imagery_url IS NOT NULL",
            name="ck_site_observations_other_needs_url",
        ),
    )
    # The zone valid on a date: the latest row per site at or before it.
    op.create_index(
        "ix_site_observations_site_captured",
        "site_observations",
        ["site_id", "captured_on", "created_at"],
    )

    # Append-only: an unlink stamps ``unlinked_at`` and an effect change closes the live row
    # and opens a new one, so every effect a link ever had stays readable.
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
    # One live link per event and site.
    op.create_index(
        "uq_event_site_links_live",
        "event_site_links",
        ["event_id", "site_id"],
        unique=True,
        postgresql_where=sa.text("unlinked_at IS NULL"),
    )
    op.create_index("ix_event_site_links_site_id", "event_site_links", ["site_id"])
    op.create_index("ix_event_site_links_event_id", "event_site_links", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_event_site_links_event_id", table_name="event_site_links")
    op.drop_index("ix_event_site_links_site_id", table_name="event_site_links")
    op.drop_index("uq_event_site_links_live", table_name="event_site_links")
    op.drop_table("event_site_links")
    op.drop_index("ix_site_observations_site_captured", table_name="site_observations")
    op.drop_table("site_observations")
    op.drop_index("ix_sites_owner_id", table_name="sites")
    op.drop_table("sites")
