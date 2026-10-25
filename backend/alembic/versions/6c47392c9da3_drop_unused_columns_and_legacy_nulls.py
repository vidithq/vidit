"""drop unused columns and legacy nulls

Revision ID: 6c47392c9da3
Revises: 7e8e211df661
Create Date: 2026-10-24 09:40:00.000000

``users.email_verified_at`` always equals ``created_at`` (registration proves the
address before the row exists), so it goes: notification email reaches every
account. ``auth_tokens.purpose`` holds one value, so it goes with its CHECK and
its ``(user_id, purpose)`` index.

``users.email``, ``users.password_hash`` and ``media.sha256`` become NOT NULL,
and ``ix_media_sha256`` covers every row. The upgrade refuses to run while a
row still holds a NULL in one of them: an account without credentials, or a
file without its fingerprint, needs a decision before this migration.

The downgrade restores ``email_verified_at`` from ``created_at`` and
``purpose`` as ``password_reset``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6c47392c9da3"
down_revision: Union[str, None] = "7e8e211df661"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NOT_NULL = (("users", "email"), ("users", "password_hash"), ("media", "sha256"))


def _refuse_nulls() -> None:
    bind = op.get_bind()
    found = []
    for table, column in _NOT_NULL:
        count = bind.execute(sa.text(f"SELECT count(*) FROM {table} WHERE {column} IS NULL")).scalar()
        if count:
            found.append(f"{table}.{column}: {count} row(s)")
    if found:
        raise RuntimeError(
            "Rows still hold NULL in a column this migration makes NOT NULL ("
            + "; ".join(found)
            + "). Fill or delete them, then run the migration again."
        )


def upgrade() -> None:
    _refuse_nulls()
    for table, column in _NOT_NULL:
        op.alter_column(table, column, nullable=False)
    op.drop_index("ix_media_sha256", table_name="media")
    op.create_index("ix_media_sha256", "media", ["sha256"])

    op.drop_column("users", "email_verified_at")

    op.drop_index("ix_auth_tokens_user_purpose", table_name="auth_tokens")
    op.drop_constraint("ck_auth_tokens_purpose", "auth_tokens", type_="check")
    op.drop_column("auth_tokens", "purpose")


def downgrade() -> None:
    op.add_column(
        "auth_tokens",
        sa.Column("purpose", sa.Text(), nullable=False, server_default="password_reset"),
    )
    op.alter_column("auth_tokens", "purpose", server_default=None)
    op.create_check_constraint("ck_auth_tokens_purpose", "auth_tokens", "purpose = 'password_reset'")
    op.create_index("ix_auth_tokens_user_purpose", "auth_tokens", ["user_id", "purpose"])

    op.add_column(
        "users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute("UPDATE users SET email_verified_at = created_at")

    op.drop_index("ix_media_sha256", table_name="media")
    op.create_index(
        "ix_media_sha256", "media", ["sha256"], postgresql_where=sa.text("sha256 IS NOT NULL")
    )
    for table, column in _NOT_NULL:
        op.alter_column(table, column, nullable=True)
