"""event model refactor: owner + coords rename, lifecycle stamps, contributor tables, media roles

Revision ID: h0j2l4n6p8r0
Revises: g9i1k3m5o7q9
Create Date: 2026-07-03 00:00:00.000000

The frozen target model of docs/data-model.md, in one pass:

* ``events``: ``author_id`` becomes ``owner_id`` (edit rights, moves to the
  fulfiller at geolocate) and ``location`` becomes ``event_coords`` (the
  subject point, now distinct from the new nullable ``capture_source_coords``
  camera point, which is deliberately unindexed: no spatial read consumes it).
  Per-state entry stamps (``requested_at`` / ``detected_at`` / ``geolocated_at``,
  ``closed_at`` already exists) plus ``close_reason`` and
  ``before_closed_status`` land, and the old location-vs-status CHECK is
  replaced by the four target CHECKs. The "requested forbids coordinates" half
  is dropped on purpose: a requested event may carry an approximate guess.

* ``event_claims`` becomes ``event_investigators`` ("claim" made no sense on
  an event); a new ``event_geolocators`` table holds durable geolocation
  credit, backfilled with each geolocated row's owner.

* ``media`` gains a ``role`` (``source`` | ``proof``) with an at-most-one-source
  partial unique index; existing dev rows are deduped to the oldest per event
  first (sanctioned: dev data only). ``proof_images`` is dropped, its job
  folded into ``media`` rows with ``role='proof'`` (uploads happen at publish
  now, so there is no unattached staging row and no orphan reaper).

* ``uploaded_ip`` / ``uploaded_user_agent`` / ``auth_events.ip`` /
  ``auth_events.user_agent`` are dropped for privacy: network context lives
  only at the Cloudflare edge.

Backfills run before the CHECKs are added so an existing dev DB upgrades
cleanly. Pre-refactor ``closed`` rows are all withdrawn requests (rejected
detections were soft-deleted), hence ``before_closed_status='requested'``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import INET

revision: str = "h0j2l4n6p8r0"
down_revision: Union[str, None] = "g9i1k3m5o7q9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── events: renames ──────────────────────────────────────────────────
    op.execute("ALTER TABLE events RENAME COLUMN author_id TO owner_id")
    op.execute("ALTER TABLE events RENAME CONSTRAINT events_author_id_fkey TO events_owner_id_fkey")
    op.execute("ALTER INDEX ix_events_author_id RENAME TO ix_events_owner_id")
    op.execute("ALTER INDEX ix_events_author_created RENAME TO ix_events_owner_created")

    op.execute("ALTER TABLE events RENAME COLUMN location TO event_coords")
    op.execute("ALTER INDEX idx_events_location RENAME TO idx_events_event_coords")

    # ── events: new columns ──────────────────────────────────────────────
    # No spatial index on capture_source_coords — deliberate, no spatial read
    # consumes it (docs/data-model.md).
    op.add_column(
        "events",
        sa.Column(
            "capture_source_coords",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=True,
        ),
    )
    op.add_column("events", sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("detected_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("geolocated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("close_reason", sa.Text(), nullable=True))
    op.add_column("events", sa.Column("before_closed_status", sa.String(length=20), nullable=True))

    # ── events: backfill the stamps (dev data), before the CHECKs land ───
    op.execute("UPDATE events SET geolocated_at = updated_at WHERE status = 'geolocated'")
    op.execute(
        "UPDATE events SET requested_at = created_at "
        "WHERE status = 'requested' OR requested_by_id IS NOT NULL"
    )
    op.execute("UPDATE events SET detected_at = created_at WHERE detected_from_url IS NOT NULL")
    # Pre-refactor closed rows are all withdrawn requests (rejected detections
    # were soft-deleted, never 'closed').
    op.execute("UPDATE events SET before_closed_status = 'requested' WHERE status = 'closed'")
    # Every write path stamped closed_at, but the CHECK below makes it a hard
    # invariant — patch any stray dev row rather than fail the upgrade.
    op.execute(
        "UPDATE events SET closed_at = updated_at WHERE status = 'closed' AND closed_at IS NULL"
    )

    # ── events: swap the CHECK set ───────────────────────────────────────
    op.drop_constraint("ck_events_location_status", "events", type_="check")
    op.create_check_constraint(
        "ck_events_coords_status",
        "events",
        "status <> 'geolocated' OR event_coords IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_events_closed_stamp",
        "events",
        "status <> 'closed' OR closed_at IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_events_geolocated_stamp",
        "events",
        "status <> 'geolocated' OR geolocated_at IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_events_before_closed_status",
        "events",
        "(status = 'closed' AND before_closed_status IS NOT NULL"
        " AND before_closed_status IN ('requested', 'detected'))"
        " OR (status <> 'closed' AND before_closed_status IS NULL)",
    )

    # ── event_claims → event_investigators ──────────────────────────────
    op.execute("ALTER TABLE event_claims RENAME TO event_investigators")
    op.execute("ALTER INDEX event_claims_pkey RENAME TO event_investigators_pkey")
    op.execute(
        "ALTER TABLE event_investigators RENAME CONSTRAINT event_claims_event_id_fkey "
        "TO event_investigators_event_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_investigators RENAME CONSTRAINT event_claims_user_id_fkey "
        "TO event_investigators_user_id_fkey"
    )
    op.execute(
        "ALTER INDEX ix_event_claims_event_id_created_at "
        "RENAME TO ix_event_investigators_event_id_created_at"
    )
    op.execute("ALTER INDEX ix_event_claims_user_id RENAME TO ix_event_investigators_user_id")

    # ── event_geolocators: durable credit for the geolocation ────────────
    op.create_table(
        "event_geolocators",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "user_id"),
    )
    # The composite PK's leading event_id serves the forward "who geolocated
    # event X" read; this index serves the reverse profile query.
    op.create_index(
        "ix_event_geolocators_user_created_at",
        "event_geolocators",
        ["user_id", "created_at"],
    )
    # The owner of every geolocated row vouched it — seed the credit table so
    # attribution predates this migration.
    op.execute(
        "INSERT INTO event_geolocators (event_id, user_id, created_at) "
        "SELECT id, owner_id, COALESCE(geolocated_at, updated_at) "
        "FROM events WHERE status = 'geolocated'"
    )

    # ── media: role + the one-source cap ─────────────────────────────────
    # server_default backfills existing rows as 'source' (every pre-refactor
    # media row is gallery footage), then the default drops so writers must
    # state the role.
    op.add_column(
        "media",
        sa.Column("role", sa.String(length=10), nullable=False, server_default=sa.text("'source'")),
    )
    op.alter_column("media", "role", server_default=None)
    op.create_check_constraint("ck_media_role_valid", "media", "role IN ('source', 'proof')")

    # Dedupe before the unique index: dev rows may carry N media per event.
    # Keep the oldest per event (created_at, id) and drop the rest —
    # sanctioned, the dev/prod DBs are wipeable.
    op.execute(
        "DELETE FROM media m USING ("
        "  SELECT id, ROW_NUMBER() OVER ("
        "    PARTITION BY event_id ORDER BY created_at, id"
        "  ) AS rn FROM media"
        ") ranked "
        "WHERE m.id = ranked.id AND ranked.rn > 1"
    )
    op.create_index(
        "uq_media_source_per_event",
        "media",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("role = 'source'"),
    )

    # ── privacy drops ────────────────────────────────────────────────────
    op.drop_column("media", "uploaded_ip")
    op.drop_column("media", "uploaded_user_agent")
    op.drop_column("auth_events", "ip")
    op.drop_column("auth_events", "user_agent")

    # ── proof_images: folded into media(role='proof') ────────────────────
    # Uploads happen at publish now, so there is no unattached staging row to
    # track (and no orphan reaper). Rows are dev data; not migrated.
    op.drop_table("proof_images")


def downgrade() -> None:
    # Best-effort: the new columns' data (stamps, roles, capture point,
    # geolocator credit) has no pre-refactor home and is discarded.

    # proof_images back (empty), shape as of g9i1k3m5o7q9.
    op.create_table(
        "proof_images",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("s3_key", sa.Text(), nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("uploaded_ip", INET(), nullable=True),
        sa.Column("uploaded_user_agent", sa.Text(), nullable=True),
        sa.Column("original_filename", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("s3_key", name="uq_proof_images_s3_key"),
    )
    op.create_index("ix_proof_images_user_id", "proof_images", ["user_id"])
    op.create_index("ix_proof_images_event_id", "proof_images", ["event_id"])
    op.create_index(
        "ix_proof_images_orphans_created_at",
        "proof_images",
        ["created_at"],
        postgresql_where=sa.text("event_id IS NULL"),
    )
    op.create_index(
        "ix_proof_images_sha256",
        "proof_images",
        ["sha256"],
        postgresql_where=sa.text("sha256 IS NOT NULL"),
    )

    op.add_column("auth_events", sa.Column("user_agent", sa.Text(), nullable=True))
    op.add_column("auth_events", sa.Column("ip", INET(), nullable=True))
    op.add_column("media", sa.Column("uploaded_user_agent", sa.Text(), nullable=True))
    op.add_column("media", sa.Column("uploaded_ip", INET(), nullable=True))

    # Proof-role rows have no pre-refactor representation as media (they were
    # proof_images rows); drop them rather than surface them as gallery media.
    op.execute("DELETE FROM media WHERE role = 'proof'")
    op.drop_index("uq_media_source_per_event", table_name="media")
    op.drop_constraint("ck_media_role_valid", "media", type_="check")
    op.drop_column("media", "role")

    op.execute("DELETE FROM event_geolocators")
    op.drop_index("ix_event_geolocators_user_created_at", table_name="event_geolocators")
    op.drop_table("event_geolocators")

    op.execute("ALTER INDEX ix_event_investigators_user_id RENAME TO ix_event_claims_user_id")
    op.execute(
        "ALTER INDEX ix_event_investigators_event_id_created_at "
        "RENAME TO ix_event_claims_event_id_created_at"
    )
    op.execute(
        "ALTER TABLE event_investigators RENAME CONSTRAINT event_investigators_user_id_fkey "
        "TO event_claims_user_id_fkey"
    )
    op.execute(
        "ALTER TABLE event_investigators RENAME CONSTRAINT event_investigators_event_id_fkey "
        "TO event_claims_event_id_fkey"
    )
    op.execute("ALTER INDEX event_investigators_pkey RENAME TO event_claims_pkey")
    op.execute("ALTER TABLE event_investigators RENAME TO event_claims")

    op.drop_constraint("ck_events_before_closed_status", "events", type_="check")
    op.drop_constraint("ck_events_geolocated_stamp", "events", type_="check")
    op.drop_constraint("ck_events_closed_stamp", "events", type_="check")
    op.drop_constraint("ck_events_coords_status", "events", type_="check")
    # The old CHECK forbade coordinates on a requested row; clear any guess
    # so re-adding it can't fail (best-effort, lossy on purpose).
    op.execute("UPDATE events SET event_coords = NULL WHERE status = 'requested'")
    op.create_check_constraint(
        "ck_events_location_status",
        "events",
        "(status <> 'requested' OR event_coords IS NULL) "
        "AND (status <> 'geolocated' OR event_coords IS NOT NULL)",
    )

    op.drop_column("events", "before_closed_status")
    op.drop_column("events", "close_reason")
    op.drop_column("events", "geolocated_at")
    op.drop_column("events", "detected_at")
    op.drop_column("events", "requested_at")
    op.drop_column("events", "capture_source_coords")

    op.execute("ALTER INDEX idx_events_event_coords RENAME TO idx_events_location")
    op.execute("ALTER TABLE events RENAME COLUMN event_coords TO location")
    op.execute("ALTER INDEX ix_events_owner_created RENAME TO ix_events_author_created")
    op.execute("ALTER INDEX ix_events_owner_id RENAME TO ix_events_author_id")
    op.execute("ALTER TABLE events RENAME CONSTRAINT events_owner_id_fkey TO events_author_id_fkey")
    op.execute("ALTER TABLE events RENAME COLUMN owner_id TO author_id")
