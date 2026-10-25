"""event detections

Revision ID: 7b0a79ff519a
Revises: e8fface9189d
Create Date: 2026-10-24 11:30:00.000000

Detection provenance moves from ``events`` to ``event_detections(event_id,
via, from_url, from_post_id, thread_post_ids, post_at)``, one row per imported
event: every event with a ``detected_from_url`` gets one, its values copied.
The re-import match indexes move with the columns. ``events.detected_at``
stays.

The downgrade copies the rows back onto ``events``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "7b0a79ff519a"
down_revision: Union[str, None] = "e8fface9189d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VIA = "via IS NULL OR via IN ('bot', 'paste', 'archive')"


def upgrade() -> None:
    op.create_table(
        "event_detections",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("via", sa.String(length=20), nullable=True),
        sa.Column("from_url", sa.Text(), nullable=False),
        sa.Column("from_post_id", sa.BigInteger(), nullable=True),
        sa.Column("thread_post_ids", postgresql.ARRAY(sa.BigInteger()), nullable=True),
        sa.Column("post_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(_VIA, name="ck_event_detections_via_valid"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.execute(
        """
        INSERT INTO event_detections
            (event_id, via, from_url, from_post_id, thread_post_ids, post_at)
        SELECT id, detected_via, detected_from_url, detected_from_post_id,
               detected_thread_post_ids, detected_post_at
        FROM events WHERE detected_from_url IS NOT NULL
        """
    )
    op.create_index(
        "ix_event_detections_from_post_id",
        "event_detections",
        ["from_post_id"],
        postgresql_where=sa.text("from_post_id IS NOT NULL"),
    )
    op.create_index(
        "ix_event_detections_thread_post_ids",
        "event_detections",
        ["thread_post_ids"],
        postgresql_using="gin",
        postgresql_where=sa.text("thread_post_ids IS NOT NULL"),
    )
    op.drop_index("ix_events_owner_detected_from_post_id", table_name="events")
    op.drop_index("ix_events_detected_thread_post_ids", table_name="events")
    op.drop_index("ix_events_detected_from_url", table_name="events")
    op.drop_constraint("ck_events_detected_via_valid", "events", type_="check")
    for column in (
        "detected_via",
        "detected_from_url",
        "detected_from_post_id",
        "detected_thread_post_ids",
        "detected_post_at",
    ):
        op.drop_column("events", column)


def downgrade() -> None:
    op.add_column("events", sa.Column("detected_post_at", sa.DateTime(timezone=True)))
    op.add_column(
        "events", sa.Column("detected_thread_post_ids", postgresql.ARRAY(sa.BigInteger()))
    )
    op.add_column("events", sa.Column("detected_from_post_id", sa.BigInteger()))
    op.add_column("events", sa.Column("detected_from_url", sa.Text()))
    op.add_column("events", sa.Column("detected_via", sa.String(length=20)))
    op.execute(
        """
        UPDATE events e SET
            detected_via = d.via,
            detected_from_url = d.from_url,
            detected_from_post_id = d.from_post_id,
            detected_thread_post_ids = d.thread_post_ids,
            detected_post_at = d.post_at
        FROM event_detections d WHERE d.event_id = e.id
        """
    )
    op.create_check_constraint(
        "ck_events_detected_via_valid",
        "events",
        "detected_via IS NULL OR detected_via IN ('bot', 'paste', 'archive')",
    )
    op.create_index(
        "ix_events_detected_from_url",
        "events",
        ["detected_from_url"],
        postgresql_where=sa.text("detected_from_url IS NOT NULL"),
    )
    op.create_index(
        "ix_events_detected_thread_post_ids",
        "events",
        ["detected_thread_post_ids"],
        postgresql_using="gin",
        postgresql_where=sa.text("detected_thread_post_ids IS NOT NULL"),
    )
    op.create_index(
        "ix_events_owner_detected_from_post_id",
        "events",
        ["owner_id", "detected_from_post_id"],
        postgresql_where=sa.text("detected_from_post_id IS NOT NULL"),
    )
    op.drop_table("event_detections")
