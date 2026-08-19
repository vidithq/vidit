"""event version redaction

Revision ID: g5i7k9m1o3q5
Revises: h6j8l0n2p4r6
Create Date: 2026-08-18 12:00:00.000000

A filed version is append-only, so the only way to take material out of one is
to blank it in place. ``redacted_at`` stamps when an admin did, and
``redacted_by_id`` who; the row, its ``version_no`` and its ``created_at``
stay, so ``/vN`` addressing never shifts and the history still shows that a
version existed.

``redacted_by_id`` is ``ON DELETE SET NULL``, matching ``edited_by_id``: erasing
the admin account must not fail on the FK, and the redaction stands either way.

Downgrade drops both columns, which loses the record of which versions were
redacted; the blanked snapshots stay blank.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "g5i7k9m1o3q5"
down_revision: Union[str, None] = "h6j8l0n2p4r6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "event_versions",
        sa.Column("redacted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "event_versions",
        sa.Column("redacted_by_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_event_versions_redacted_by_id_users",
        "event_versions",
        "users",
        ["redacted_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_event_versions_redacted_by_id_users", "event_versions", type_="foreignkey"
    )
    op.drop_column("event_versions", "redacted_by_id")
    op.drop_column("event_versions", "redacted_at")
