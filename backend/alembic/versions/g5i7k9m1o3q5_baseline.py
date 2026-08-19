"""baseline

Revision ID: g5i7k9m1o3q5
Revises:
Create Date: 2026-08-19 16:00:00.000000

The single starting point of the migration chain. It builds the whole schema
in one step and carries the revision id of the last incremental migration it
replaces, so a database already stamped ``g5i7k9m1o3q5`` needs no stamp and
runs nothing. A fresh database runs this file alone.

Contents beyond a plain autogenerate: the ``postgis`` extension, the
expression and partial indexes the incremental chain added by hand (the two
full-text GIN indexes, the report queue index, the live-row indexes), the
``ck_auth_tokens_purpose`` check, the constraint names the chain renamed into
place, and the two seed sets a fresh database needs (the ``capture_source``
tag taxonomy and the ``Other`` conflict escape value).
"""

import uuid
from typing import Sequence, Union

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert as pg_insert

# revision identifiers, used by Alembic.
revision: str = "g5i7k9m1o3q5"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The original-lens taxonomy the submit form requires. "Unknown" is the escape
# value that keeps the required selector satisfiable for media of uncertain
# provenance. The API sorts by name for the UI.
CAPTURE_SOURCE_TAGS = [
    "Smartphone",
    "Satellite",
    "Drone",
    "Static camera",
    "Dashcam",
    "Body / helmet cam",
    "Unknown",
]

# Escape value for the required conflict selector. The real conflict list is
# owner-curated (the sync + seed writers fill it); this generic catch-all is
# part of the product taxonomy, so it ships in code.
CONFLICT_ESCAPE_NAME = "Other"

# Core handles, kept self-contained (no app-model import) so a later change to
# the ORM models cannot retro-alter this migration.
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

# Reused between the migration and the runtime search query: Postgres refuses
# the index unless the SELECT expression matches byte for byte. 'simple'
# rather than 'english' because the corpus is analyst handles, place names and
# OSINT identifiers, none of which stem cleanly.
_EVENT_TSVECTOR = "to_tsvector('simple', coalesce(title, ''))"
_USER_TSVECTOR = "to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(bio, ''))"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "tags",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "conflicts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("wikidata_id", sa.String(length=20), nullable=True),
        sa.Column("start_year", sa.Integer(), nullable=True),
        sa.Column("end_year", sa.Integer(), nullable=True),
        sa.Column("tier", sa.String(length=10), nullable=True),
        sa.Column("ongoing", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("wikidata_id"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column(
            "external_links",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("token_version", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("x_handle", sa.String(length=50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("username"),
        sa.UniqueConstraint("x_handle"),
    )
    op.create_index(
        "ix_users_live", "users", ["created_at"], postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.execute(f"CREATE INDEX ix_users_search_fts ON users USING GIN ({_USER_TSVECTOR})")

    op.create_table(
        "bot_mentions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mention_tweet_id", sa.String(length=25), nullable=False),
        sa.Column("author_handle", sa.String(length=50), nullable=False),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("events_created", sa.Integer(), nullable=False),
        sa.Column("reply_tweet_id", sa.String(length=25), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mention_tweet_id"),
    )
    op.create_table(
        "bot_webhook_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mention", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_bot_webhook_events_status_created_at", "bot_webhook_events", ["status", "created_at"]
    )

    op.create_table(
        "admin_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_events_actor_id", "admin_events", ["actor_id"])
    op.create_index("ix_admin_events_created_at", "admin_events", ["created_at"])

    op.create_table(
        "archive_import_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("zip_key", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("post_estimate", sa.Integer(), nullable=True),
        sa.Column("progress_done", sa.Integer(), nullable=False),
        sa.Column("progress_total", sa.Integer(), nullable=True),
        sa.Column("created_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_archive_import_jobs_owner_id", "archive_import_jobs", ["owner_id"])
    op.create_index("ix_archive_import_jobs_status", "archive_import_jobs", ["status"])

    op.create_table(
        "auth_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("event", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_events_event_created_at", "auth_events", ["event", "created_at"])
    op.create_index("ix_auth_events_user_id_created_at", "auth_events", ["user_id", "created_at"])

    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("purpose = 'password_reset'", name="ck_auth_tokens_purpose"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_auth_tokens_token_hash"),
    )
    op.create_index(
        "ix_auth_tokens_live_expires_at",
        "auth_tokens",
        ["expires_at"],
        postgresql_where=sa.text("consumed_at IS NULL"),
    )
    op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"])
    op.create_index("ix_auth_tokens_user_purpose", "auth_tokens", ["user_id", "purpose"])

    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("used_by", sa.Uuid(), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("x_handle", sa.String(length=50), nullable=True),
        sa.ForeignKeyConstraint(["used_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )

    op.create_table(
        "pending_registrations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("invite_code_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["invite_code_id"], ["invite_codes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_pending_registrations_email"),
        sa.UniqueConstraint("token_hash", name="uq_pending_registrations_token_hash"),
        sa.UniqueConstraint("username", name="uq_pending_registrations_username"),
    )
    op.create_index("ix_pending_registrations_expires_at", "pending_registrations", ["expires_at"])

    op.create_table(
        "follows",
        sa.Column("follower_id", sa.Uuid(), nullable=False),
        sa.Column("followed_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("follower_id <> followed_id", name="ck_follows_no_self_follow"),
        sa.ForeignKeyConstraint(["followed_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["follower_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("follower_id", "followed_id"),
    )
    op.create_index("ix_follows_followed_id", "follows", ["followed_id"])

    # ``event_coords`` keeps GeoAlchemy2's default GIST index (created with the
    # table as ``idx_events_event_coords``); ``capture_source_coords`` is only
    # ever read back with the row, so it carries none.
    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column(
            "event_coords",
            geoalchemy2.types.Geometry(
                geometry_type="POINT", srid=4326, dimension=2, spatial_index=True
            ),
            nullable=True,
        ),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("proof", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default=sa.text("'geolocated'"),
            nullable=False,
        ),
        sa.Column("detected_from_url", sa.Text(), nullable=True),
        sa.Column("source_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("event_time", sa.Time(), nullable=True),
        sa.Column("detected_post_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_by_id", sa.Uuid(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "capture_source_coords",
            geoalchemy2.types.Geometry(
                geometry_type="POINT", srid=4326, dimension=2, spatial_index=False
            ),
            nullable=True,
        ),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("geolocated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("close_reason", sa.Text(), nullable=True),
        sa.Column("before_closed_status", sa.String(length=20), nullable=True),
        sa.Column("is_graphic", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detected_from_tweet_id", sa.BigInteger(), nullable=True),
        sa.Column("detected_thread_tweet_ids", postgresql.ARRAY(sa.BigInteger()), nullable=True),
        sa.Column("detected_via", sa.String(length=20), nullable=True),
        sa.Column("version_no", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.CheckConstraint(
            "(status = 'closed' AND before_closed_status IS NOT NULL "
            "AND before_closed_status IN ('requested', 'detected')) "
            "OR (status <> 'closed' AND before_closed_status IS NULL)",
            name="ck_events_before_closed_status",
        ),
        sa.CheckConstraint(
            "status <> 'closed' OR closed_at IS NOT NULL", name="ck_events_closed_stamp"
        ),
        sa.CheckConstraint(
            "status <> 'geolocated' OR event_coords IS NOT NULL", name="ck_events_coords_status"
        ),
        sa.CheckConstraint(
            "detected_via IS NULL OR detected_via IN ('bot', 'paste', 'archive')",
            name="ck_events_detected_via_valid",
        ),
        sa.CheckConstraint(
            "status <> 'geolocated' OR geolocated_at IS NOT NULL",
            name="ck_events_geolocated_stamp",
        ),
        sa.CheckConstraint(
            "status NOT IN ('requested', 'geolocated') OR source_url IS NOT NULL",
            name="ck_events_source_url_status",
        ),
        sa.CheckConstraint(
            "status IN ('requested', 'detected', 'geolocated', 'closed')",
            name="ck_events_status_valid",
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_events_created_at", "events", ["created_at"])
    op.create_index("ix_events_created_at_id", "events", ["created_at", "id"])
    op.create_index(
        "ix_events_detected_from_url",
        "events",
        ["detected_from_url"],
        postgresql_where=sa.text("detected_from_url IS NOT NULL"),
    )
    op.create_index(
        "ix_events_detected_thread_tweet_ids",
        "events",
        ["detected_thread_tweet_ids"],
        postgresql_using="gin",
        postgresql_where=sa.text("detected_thread_tweet_ids IS NOT NULL"),
    )
    op.create_index("ix_events_event_date", "events", ["event_date"])
    op.create_index(
        "ix_events_live", "events", ["created_at"], postgresql_where=sa.text("deleted_at IS NULL")
    )
    op.execute("CREATE INDEX ix_events_owner_created ON events (owner_id, created_at DESC)")
    op.create_index(
        "ix_events_owner_detected_from_tweet_id",
        "events",
        ["owner_id", "detected_from_tweet_id"],
        postgresql_where=sa.text("detected_from_tweet_id IS NOT NULL"),
    )
    op.create_index("ix_events_owner_id", "events", ["owner_id"])
    op.execute(f"CREATE INDEX ix_events_search_fts ON events USING GIN ({_EVENT_TSVECTOR})")
    op.create_index("ix_events_status_created_at", "events", ["status", "created_at"])

    op.create_table(
        "event_conflicts",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("conflict_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["conflict_id"], ["conflicts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "conflict_id"),
    )
    op.create_table(
        "event_geolocators",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "user_id"),
    )
    op.create_index(
        "ix_event_geolocators_user_created_at", "event_geolocators", ["user_id", "created_at"]
    )
    op.create_table(
        "event_source_links",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "position"),
    )
    op.create_table(
        "event_tags",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("tag_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "tag_id"),
    )
    op.create_table(
        "event_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("edited_by_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("redacted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redacted_by_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["edited_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["redacted_by_id"],
            ["users.id"],
            name="fk_event_versions_redacted_by_id_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "version_no", name="uq_event_versions_event_no"),
    )

    op.create_table(
        "media",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("storage_url", sa.Text(), nullable=False),
        sa.Column("media_type", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("original_filename", sa.Text(), nullable=True),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.CheckConstraint("role IN ('source', 'proof')", name="ck_media_role_valid"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_media_event_id", "media", ["event_id"])
    op.create_index(
        "ix_media_sha256", "media", ["sha256"], postgresql_where=sa.text("sha256 IS NOT NULL")
    )
    op.create_index(
        "uq_media_source_per_event",
        "media",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("role = 'source'"),
    )

    op.create_table(
        "content_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.String(length=30), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("reporter_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.String(length=30), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "reason IN ('illegal_content', 'graphic_not_flagged', 'copyright', 'privacy', 'other')",
            name="ck_content_reports_reason_valid",
        ),
        sa.CheckConstraint(
            "(resolution IS NULL AND resolved_at IS NULL) "
            "OR (resolution IS NOT NULL AND resolved_at IS NOT NULL)",
            name="ck_content_reports_resolution_stamp",
        ),
        sa.CheckConstraint(
            "resolution IS NULL OR resolution IN ('marked_graphic', 'hidden', 'dismissed')",
            name="ck_content_reports_resolution_valid",
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_content_reports_event_id", "content_reports", ["event_id"])
    # Open reports first, newest first, with ``id`` breaking ties: the exact
    # ordering the admin queue pages through.
    op.execute(
        "CREATE INDEX ix_content_reports_queue ON content_reports "
        "((resolved_at IS NOT NULL), created_at DESC, id DESC)"
    )

    op.create_table(
        "source_archives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("original_url", sa.Text(), nullable=False),
        sa.Column("origin", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snapshot_url", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.CheckConstraint(
            "origin IN ('source_url', 'secondary_source', 'detected_from', 'proof_link')",
            name="ck_source_archives_origin_valid",
        ),
        sa.CheckConstraint(
            "provider IN ('wayback', 'archive_today')",
            name="ck_source_archives_provider_valid",
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "original_url", name="uq_source_archives_event_url"),
    )
    op.create_index("ix_source_archives_event_id", "source_archives", ["event_id"])

    _seed()


def _seed() -> None:
    """Rows the submit form's required selectors need on a fresh database.

    ``tags.id`` and ``conflicts.id`` have no server default (the ORM supplies
    ``uuid.uuid4``), so a Core insert passes ``id`` explicitly.
    ``ON CONFLICT (name) DO NOTHING`` keeps both inserts idempotent.
    """
    op.execute(
        pg_insert(_tags)
        .values(
            [
                {"id": uuid.uuid4(), "name": name, "category": "capture_source"}
                for name in CAPTURE_SOURCE_TAGS
            ]
        )
        .on_conflict_do_nothing(index_elements=["name"])
    )
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
    """Drop every table this migration creates, children first.

    Indexes and constraints go with their tables. The ``postgis`` extension
    stays: it predates the schema on a PostGIS image and other databases in the
    cluster may hold geometry columns.
    """
    op.drop_table("source_archives")
    op.drop_table("content_reports")
    op.drop_table("media")
    op.drop_table("event_versions")
    op.drop_table("event_tags")
    op.drop_table("event_source_links")
    op.drop_table("event_geolocators")
    op.drop_table("event_conflicts")
    op.drop_table("events")
    op.drop_table("follows")
    op.drop_table("pending_registrations")
    op.drop_table("invite_codes")
    op.drop_table("auth_tokens")
    op.drop_table("auth_events")
    op.drop_table("archive_import_jobs")
    op.drop_table("admin_events")
    op.drop_table("bot_webhook_events")
    op.drop_table("bot_mentions")
    op.drop_table("users")
    op.drop_table("conflicts")
    op.drop_table("tags")
