"""merge bounties into the geolocation event lifecycle

Revision ID: d6f8h0j2l4n6
Revises: c5e7g9i1k3m5
Create Date: 2026-07-02 00:00:00.000000

Folds the two-table bounty + geolocation split into one ``geolocations`` event
whose ``status`` is the lifecycle: ``requested`` (an open call to geolocate,
yesterday's bounty ``open``), ``detected`` (machine draft), ``geolocated``
(human-vouched, yesterday's geolocation ``submitted`` + a fulfilled bounty),
``closed`` (withdrawn / rejected). ``location`` becomes nullable, its presence
tied to ``status`` by ``ck_geolocations_location_status``. The bounty →
geolocation promotion apparatus is removed; fulfilment is now a single UPDATE.

Data fold: open / closed bounties become ``requested`` / ``closed`` geolocations
reusing the bounty id (so their media / tags / claims keep pointing at the same
UUID); already-fulfilled bounties are not duplicated (their geolocation already
exists), only their poster is preserved via the new ``requested_by_id``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "d6f8h0j2l4n6"
down_revision: Union[str, None] = "c5e7g9i1k3m5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Inline empty Tiptap doc — a bounty's ``proof`` is nullable, a geolocation's is
# NOT NULL, so a missing bounty proof folds to the empty document.
EMPTY_DOC = "'{\"type\": \"doc\", \"content\": []}'::jsonb"


def upgrade() -> None:
    # 1. geolocations: new columns + relaxations + status value rename.
    op.add_column("geolocations", sa.Column("requested_by_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "geolocations_requested_by_id_fkey",
        "geolocations",
        "users",
        ["requested_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "geolocations", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute("ALTER TABLE geolocations ALTER COLUMN location DROP NOT NULL")
    op.alter_column("geolocations", "event_date", existing_type=sa.Date(), nullable=True)
    op.execute("UPDATE geolocations SET status = 'geolocated' WHERE status = 'submitted'")
    op.alter_column(
        "geolocations",
        "status",
        existing_type=sa.String(length=20),
        server_default=sa.text("'geolocated'"),
    )

    # Preserve who opened each already-fulfilled bounty on its geolocation,
    # before the trace column is dropped in step 6.
    op.execute(
        "UPDATE geolocations g SET requested_by_id = b.author_id "
        "FROM bounties b WHERE g.originated_from_bounty_id = b.id"
    )

    # 2. Fold non-fulfilled bounties into geolocations FIRST, reusing the bounty
    #    id, so the media / tags / claims below repoint to an existing row (the
    #    FK media.geolocation_id -> geolocations.id is checked per-statement).
    op.execute(
        "INSERT INTO geolocations "
        "(id, author_id, requested_by_id, title, source_url, proof, event_date, "
        " event_time, source_posted_at, status, closed_at, created_at, updated_at, "
        " deleted_at, is_demo) "
        "SELECT id, author_id, author_id, title, source_url, "
        f"       COALESCE(proof, {EMPTY_DOC}), event_date, event_time, source_posted_at, "
        "       CASE status WHEN 'open' THEN 'requested' ELSE 'closed' END, "
        "       closed_at, created_at, updated_at, deleted_at, is_demo "
        "FROM bounties WHERE status <> 'fulfilled'"
    )

    # 3. media: collapse the bounty / geolocation XOR to a single owner. Drop the
    #    XOR check first (the copy transiently leaves both columns set), then
    #    point open / closed bounty media at the folded geolocation (same id).
    op.drop_constraint("ck_media_exactly_one_owner", "media", type_="check")
    op.execute("UPDATE media SET geolocation_id = bounty_id WHERE bounty_id IS NOT NULL")
    op.drop_constraint("fk_media_bounty_id", "media", type_="foreignkey")
    op.drop_column("media", "bounty_id")
    op.alter_column("media", "geolocation_id", existing_type=sa.Uuid(), nullable=False)

    # 4. tags: fold non-fulfilled bounty tags (a fulfilled bounty keeps the
    #    fulfiller's geolocation tags).
    op.execute(
        "INSERT INTO geolocation_tags (geolocation_id, tag_id) "
        "SELECT bt.bounty_id, bt.tag_id FROM bounty_tags bt "
        "JOIN bounties b ON b.id = bt.bounty_id WHERE b.status <> 'fulfilled' "
        "ON CONFLICT DO NOTHING"
    )

    # 5. claims: move bounty_claims into a fresh geolocation_claims table. A
    #    fulfilled bounty's claims point at its fulfilling geolocation (via the
    #    trace, still present here); an open / closed one's at the folded row.
    op.create_table(
        "geolocation_claims",
        sa.Column("geolocation_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["geolocation_id"], ["geolocations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("geolocation_id", "user_id"),
    )
    op.execute(
        "INSERT INTO geolocation_claims (geolocation_id, user_id, created_at) "
        "SELECT COALESCE(g.id, bc.bounty_id), bc.user_id, bc.created_at "
        "FROM bounty_claims bc "
        "LEFT JOIN geolocations g ON g.originated_from_bounty_id = bc.bounty_id "
        "ON CONFLICT DO NOTHING"
    )
    op.create_index(
        "ix_geolocation_claims_geolocation_id_created_at",
        "geolocation_claims",
        ["geolocation_id", "created_at"],
    )
    op.create_index("ix_geolocation_claims_user_id", "geolocation_claims", ["user_id"])
    op.drop_table("bounty_claims")

    # 6. drop the geolocations → bounty trace and the bounty tables.
    op.drop_index("uq_geolocations_originated_from_bounty_id", table_name="geolocations")
    op.drop_index("ix_geolocations_originated_from_bounty_id", table_name="geolocations")
    op.drop_constraint(
        "fk_geolocations_originated_from_bounty_id", "geolocations", type_="foreignkey"
    )
    op.drop_column("geolocations", "originated_from_bounty_id")
    op.drop_table("bounty_tags")
    op.drop_table("bounties")

    # 7. the new lifecycle invariants.
    op.create_check_constraint(
        "ck_geolocations_location_status",
        "geolocations",
        "(status <> 'requested' OR location IS NULL) "
        "AND (status <> 'geolocated' OR location IS NOT NULL)",
    )
    op.create_index(
        "ix_geolocations_status_created_at", "geolocations", ["status", "created_at"]
    )


def downgrade() -> None:
    # A faithful un-merge is not possible: a fulfilled bounty's original id was
    # discarded at fulfilment. This restores the two-table SCHEMA and moves open /
    # closed requests back into ``bounties``; already-geolocated events (including
    # former fulfilled bounties) stay as geolocations, and detected rows are
    # assumed to carry a location (as they did pre-merge).
    op.drop_index("ix_geolocations_status_created_at", table_name="geolocations")
    op.drop_constraint("ck_geolocations_location_status", "geolocations", type_="check")

    op.create_table(
        "bounties",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("proof", JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("event_time", sa.Time(), nullable=True),
        sa.Column("source_posted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'open'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bounties_status_created_at", "bounties", ["status", "created_at"])
    op.create_index("ix_bounties_author_id", "bounties", ["author_id"])
    op.create_index("ix_bounties_deleted_at", "bounties", ["deleted_at"])
    op.create_table(
        "bounty_tags",
        sa.Column("bounty_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["bounty_id"], ["bounties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("bounty_id", "tag_id"),
    )

    op.add_column(
        "geolocations", sa.Column("originated_from_bounty_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_geolocations_originated_from_bounty_id",
        "geolocations",
        "bounties",
        ["originated_from_bounty_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_geolocations_originated_from_bounty_id",
        "geolocations",
        ["originated_from_bounty_id"],
    )
    op.create_index(
        "uq_geolocations_originated_from_bounty_id",
        "geolocations",
        ["originated_from_bounty_id"],
        unique=True,
        postgresql_where=sa.text("originated_from_bounty_id IS NOT NULL"),
    )

    op.add_column("media", sa.Column("bounty_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_media_bounty_id", "media", "bounties", ["bounty_id"], ["id"], ondelete="CASCADE"
    )
    op.alter_column("media", "geolocation_id", existing_type=sa.Uuid(), nullable=True)

    # Move open / closed requests back into bounties.
    op.execute(
        "INSERT INTO bounties (id, author_id, title, source_url, proof, event_date, "
        " event_time, source_posted_at, status, created_at, updated_at, closed_at, "
        " deleted_at, is_demo) "
        "SELECT id, author_id, title, source_url, proof, event_date, event_time, "
        "       source_posted_at, CASE status WHEN 'requested' THEN 'open' ELSE 'closed' END, "
        "       created_at, updated_at, closed_at, deleted_at, is_demo "
        "FROM geolocations WHERE status IN ('requested', 'closed')"
    )
    op.execute(
        "UPDATE media SET bounty_id = geolocation_id, geolocation_id = NULL "
        "WHERE geolocation_id IN (SELECT id FROM bounties)"
    )
    op.execute(
        "INSERT INTO bounty_tags (bounty_id, tag_id) "
        "SELECT geolocation_id, tag_id FROM geolocation_tags "
        "WHERE geolocation_id IN (SELECT id FROM bounties) ON CONFLICT DO NOTHING"
    )
    op.execute("DELETE FROM geolocation_tags WHERE geolocation_id IN (SELECT id FROM bounties)")

    op.create_table(
        "bounty_claims",
        sa.Column("bounty_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["bounty_id"], ["bounties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("bounty_id", "user_id"),
    )
    op.create_index(
        "ix_bounty_claims_bounty_id_created_at", "bounty_claims", ["bounty_id", "created_at"]
    )
    op.create_index("ix_bounty_claims_user_id", "bounty_claims", ["user_id"])
    op.execute(
        "INSERT INTO bounty_claims (bounty_id, user_id, created_at) "
        "SELECT geolocation_id, user_id, created_at FROM geolocation_claims "
        "WHERE geolocation_id IN (SELECT id FROM bounties)"
    )
    op.execute("DELETE FROM geolocation_claims WHERE geolocation_id IN (SELECT id FROM bounties)")
    op.execute("DELETE FROM geolocations WHERE status IN ('requested', 'closed')")
    op.drop_table("geolocation_claims")

    op.create_check_constraint(
        "ck_media_exactly_one_owner",
        "media",
        "(geolocation_id IS NOT NULL AND bounty_id IS NULL) "
        "OR (geolocation_id IS NULL AND bounty_id IS NOT NULL)",
    )

    op.execute("UPDATE geolocations SET status = 'submitted' WHERE status = 'geolocated'")
    op.alter_column(
        "geolocations",
        "status",
        existing_type=sa.String(length=20),
        server_default=sa.text("'submitted'"),
    )
    # A coord-less ``detected`` row (the CHECK permits it) has no pre-merge form
    # (pre-merge every geolocation carried a location), so it cannot be un-merged;
    # drop any before restoring NOT NULL. None exist today (detection always sets a
    # coordinate), so this is a safety net, not a lossy step in practice.
    op.execute("DELETE FROM geolocations WHERE location IS NULL")
    op.execute("ALTER TABLE geolocations ALTER COLUMN location SET NOT NULL")
    op.alter_column("geolocations", "event_date", existing_type=sa.Date(), nullable=False)
    op.drop_column("geolocations", "closed_at")
    op.drop_constraint("geolocations_requested_by_id_fkey", "geolocations", type_="foreignkey")
    op.drop_column("geolocations", "requested_by_id")
