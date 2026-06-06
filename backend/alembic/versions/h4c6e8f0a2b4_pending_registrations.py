"""pending_registrations — hold partial registration until email is confirmed

Revision ID: h4c6e8f0a2b4
Revises: g3b5d7e9f1a3
Create Date: 2026-05-11 09:00:00.000000

Pre-creation email verification: ``/auth/register`` no longer creates
the ``users`` row. It stores the supplied identity (email, username,
password_hash, invite_code_id) here and emails a confirmation link.
The ``users`` row is created at ``/auth/confirm-registration``, when
the user proves they own the address.

Uniqueness on ``email`` + ``username`` is a plain UNIQUE constraint
(not partial) — Postgres requires partial-index predicates to be
IMMUTABLE, and ``expires_at > now()`` is STABLE. Stale rows are
deleted by the reaper and by the create path before insert, so a
recently-expired pending registration does not permanently pin its
address; a hard UNIQUE keeps the race-window protection without
needing a predicate.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "h4c6e8f0a2b4"
down_revision: Union[str, None] = "g3b5d7e9f1a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
        sa.ForeignKeyConstraint(
            ["invite_code_id"],
            ["invite_codes.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_pending_registrations_email"),
        sa.UniqueConstraint("username", name="uq_pending_registrations_username"),
        sa.UniqueConstraint("token_hash", name="uq_pending_registrations_token_hash"),
    )
    op.create_index(
        "ix_pending_registrations_expires_at",
        "pending_registrations",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_pending_registrations_expires_at",
        table_name="pending_registrations",
    )
    op.drop_table("pending_registrations")
