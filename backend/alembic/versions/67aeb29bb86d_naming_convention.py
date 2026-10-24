"""naming convention

Revision ID: 67aeb29bb86d
Revises: 6c47392c9da3
Create Date: 2026-10-24 10:00:00.000000

Applies the naming convention of ``docs/engineering.md``: ``auth_tokens``
becomes ``password_reset_tokens``, 24 columns take their conventional name
(the indexes and constraints that carried an old name follow), and the
background queues share one status vocabulary: ``processing`` and ``sending``
become ``running``, ``sent`` becomes ``done``. ``bot_mentions`` stores post ids
as ``bigint``. ``tags`` and ``conflicts`` gain ``created_at``, set to the
migration time on existing rows. Enum columns without a CHECK get one, and the
two audience CHECKs take the ``_valid`` suffix.

The stored version snapshots carry the renamed event fields, so their keys are
renamed too: ``event_coords``, ``event_date`` and ``event_time`` become
``coords``, ``occurred_date`` and ``occurred_time``, and ``media_type`` in each
media entry becomes ``kind``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "67aeb29bb86d"
down_revision: Union[str, None] = "6c47392c9da3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("users", "invite_minting_enabled", "is_invite_minting_enabled"),
    ("invite_codes", "used_by", "used_by_id"),
    ("invite_codes", "created_by", "created_by_id"),
    ("events", "event_coords", "coords"),
    ("events", "detected_from_tweet_id", "detected_from_post_id"),
    ("events", "detected_thread_tweet_ids", "detected_thread_post_ids"),
    ("events", "event_date", "occurred_date"),
    ("events", "event_time", "occurred_time"),
    ("content_reports", "reporter_user_id", "reporter_id"),
    ("content_reports", "resolved_by", "resolved_by_id"),
    ("media", "media_type", "kind"),
    ("conflicts", "ongoing", "is_ongoing"),
    ("conflicts", "source", "origin"),
    ("notification_deliveries", "attempts", "attempt_count"),
    ("bot_mentions", "mention_tweet_id", "mention_post_id"),
    ("bot_mentions", "reply_tweet_id", "reply_post_id"),
    ("bot_mentions", "author_handle", "author_x_handle"),
    ("bot_mentions", "events_created", "created_event_count"),
    ("bot_webhook_events", "mention", "payload"),
    ("bot_webhook_events", "attempts", "attempt_count"),
    ("archive_import_jobs", "attempts", "attempt_count"),
    ("archive_import_jobs", "post_estimate", "estimated_post_count"),
    ("archive_import_jobs", "progress_done", "processed_detection_count"),
    ("archive_import_jobs", "progress_total", "detection_count"),
)

# (table, old name, new name), indexes and constraints alike: ALTER INDEX
# renames a unique or primary key constraint's index, and with it the constraint.
_INDEXES = (
    ("auth_tokens_pkey", "password_reset_tokens_pkey"),
    ("uq_auth_tokens_token_hash", "uq_password_reset_tokens_token_hash"),
    ("ix_auth_tokens_user_id", "ix_password_reset_tokens_user_id"),
    ("ix_auth_tokens_live_expires_at", "ix_password_reset_tokens_live_expires_at"),
    ("ix_invite_codes_created_by_created_at", "ix_invite_codes_created_by_id_created_at"),
    ("idx_events_event_coords", "idx_events_coords"),
    ("ix_events_owner_detected_from_tweet_id", "ix_events_owner_detected_from_post_id"),
    ("ix_events_detected_thread_tweet_ids", "ix_events_detected_thread_post_ids"),
    ("ix_events_event_date", "ix_events_occurred_date"),
    ("bot_mentions_mention_tweet_id_key", "bot_mentions_mention_post_id_key"),
)
_CONSTRAINTS = (
    ("password_reset_tokens", "auth_tokens_user_id_fkey", "password_reset_tokens_user_id_fkey"),
    ("invite_codes", "invite_codes_used_by_fkey", "invite_codes_used_by_id_fkey"),
    ("invite_codes", "invite_codes_created_by_fkey", "invite_codes_created_by_id_fkey"),
    ("content_reports", "content_reports_reporter_user_id_fkey", "content_reports_reporter_id_fkey"),
    ("content_reports", "content_reports_resolved_by_fkey", "content_reports_resolved_by_id_fkey"),
    (
        "user_preferences",
        "ck_user_preferences_approval_request_audience",
        "ck_user_preferences_approval_request_audience_valid",
    ),
    (
        "organizations",
        "ck_organizations_approval_request_audience",
        "ck_organizations_approval_request_audience_valid",
    ),
)

# (table, CHECK name, condition) added on enum columns that had none.
_CHECKS = (
    ("media", "ck_media_kind_valid", "kind IN ('image', 'video')"),
    ("conflicts", "ck_conflicts_origin_valid", "origin IN ('sync', 'seed', 'manual')"),
    (
        "conflicts",
        "ck_conflicts_tier_valid",
        "tier IS NULL OR tier IN ('major', 'minor', 'conflict')",
    ),
    ("tags", "ck_tags_category_valid", "category IN ('capture_source', 'free')"),
    (
        "archive_import_jobs",
        "ck_archive_import_jobs_status_valid",
        "status IN ('queued', 'running', 'done', 'failed')",
    ),
    (
        "bot_mentions",
        "ck_bot_mentions_outcome_valid",
        "outcome IN ('created', 'updated', 'requested', 'inherited', 'no_detection', "
        "'no_account', 'skipped', 'self', 'failed')",
    ),
)

_DELIVERY_STATUS_CHECK = "ck_notification_deliveries_status_valid"
_DELIVERY_SENT_INDEX = "ix_notification_deliveries_sent_at"

_SNAPSHOT_KEYS = (
    ("event_coords", "coords"),
    ("event_date", "occurred_date"),
    ("event_time", "occurred_time"),
)


def _rename_snapshot_key(old: str, new: str) -> None:
    op.execute(
        f"""
        UPDATE event_versions
        SET snapshot = (snapshot - '{old}') || jsonb_build_object('{new}', snapshot -> '{old}')
        WHERE snapshot ? '{old}'
        """
    )


def _rename_media_entry_key(old: str, new: str) -> None:
    for media_list in ("source_media", "proof_media"):
        op.execute(
            f"""
            UPDATE event_versions
            SET snapshot = jsonb_set(
                snapshot,
                '{{{media_list}}}',
                (
                    SELECT COALESCE(
                        jsonb_agg(
                            CASE WHEN e ? '{old}'
                                THEN (e - '{old}') || jsonb_build_object('{new}', e -> '{old}')
                                ELSE e
                            END
                            ORDER BY i
                        ),
                        '[]'::jsonb
                    )
                    FROM jsonb_array_elements(snapshot -> '{media_list}') WITH ORDINALITY AS a(e, i)
                )
            )
            WHERE jsonb_typeof(snapshot -> '{media_list}') = 'array'
            """
        )


def _delivery_vocabulary(statuses: str, sent: str) -> None:
    op.drop_index(_DELIVERY_SENT_INDEX, table_name="notification_deliveries")
    op.create_check_constraint(
        _DELIVERY_STATUS_CHECK, "notification_deliveries", f"status IN ({statuses})"
    )
    op.create_index(
        _DELIVERY_SENT_INDEX,
        "notification_deliveries",
        ["sent_at"],
        postgresql_where=sa.text(f"status = '{sent}'"),
    )


def upgrade() -> None:
    op.rename_table("auth_tokens", "password_reset_tokens")
    for table, old, new in _COLUMNS:
        op.alter_column(table, old, new_column_name=new)
    for old, new in _INDEXES:
        op.execute(f'ALTER INDEX "{old}" RENAME TO "{new}"')
    for table, old, new in _CONSTRAINTS:
        op.execute(f'ALTER TABLE "{table}" RENAME CONSTRAINT "{old}" TO "{new}"')

    op.alter_column(
        "bot_mentions",
        "mention_post_id",
        type_=sa.BigInteger(),
        postgresql_using="mention_post_id::bigint",
    )
    op.alter_column(
        "bot_mentions",
        "reply_post_id",
        type_=sa.BigInteger(),
        postgresql_using="reply_post_id::bigint",
    )

    op.drop_constraint(_DELIVERY_STATUS_CHECK, "notification_deliveries", type_="check")
    op.execute("UPDATE notification_deliveries SET status = 'running' WHERE status = 'sending'")
    op.execute("UPDATE notification_deliveries SET status = 'done' WHERE status = 'sent'")
    _delivery_vocabulary("'queued', 'running', 'done', 'failed', 'skipped'", "done")
    op.execute("UPDATE bot_webhook_events SET status = 'running' WHERE status = 'processing'")

    for table in ("tags", "conflicts"):
        op.add_column(
            table,
            sa.Column(
                "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
            ),
        )
        op.alter_column(table, "created_at", server_default=None)

    for table, name, condition in _CHECKS:
        op.create_check_constraint(name, table, condition)

    for old, new in _SNAPSHOT_KEYS:
        _rename_snapshot_key(old, new)
    _rename_media_entry_key("media_type", "kind")


def downgrade() -> None:
    _rename_media_entry_key("kind", "media_type")
    for old, new in _SNAPSHOT_KEYS:
        _rename_snapshot_key(new, old)

    for table, name, _condition in _CHECKS:
        op.drop_constraint(name, table, type_="check")
    for table in ("tags", "conflicts"):
        op.drop_column(table, "created_at")

    op.execute("UPDATE bot_webhook_events SET status = 'processing' WHERE status = 'running'")
    op.drop_constraint(_DELIVERY_STATUS_CHECK, "notification_deliveries", type_="check")
    op.execute("UPDATE notification_deliveries SET status = 'sending' WHERE status = 'running'")
    op.execute("UPDATE notification_deliveries SET status = 'sent' WHERE status = 'done'")
    _delivery_vocabulary("'queued', 'sending', 'sent', 'failed', 'skipped'", "sent")

    op.alter_column(
        "bot_mentions",
        "reply_post_id",
        type_=sa.String(length=25),
        postgresql_using="reply_post_id::text",
    )
    op.alter_column(
        "bot_mentions",
        "mention_post_id",
        type_=sa.String(length=25),
        postgresql_using="mention_post_id::text",
    )

    for table, old, new in reversed(_CONSTRAINTS):
        op.execute(f'ALTER TABLE "{table}" RENAME CONSTRAINT "{new}" TO "{old}"')
    for old, new in reversed(_INDEXES):
        op.execute(f'ALTER INDEX "{new}" RENAME TO "{old}"')
    for table, old, new in reversed(_COLUMNS):
        op.alter_column(table, new, new_column_name=old)
    op.rename_table("password_reset_tokens", "auth_tokens")
