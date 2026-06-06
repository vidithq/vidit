import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Single source of truth for the `purpose` column values. Mirrored in the
# CHECK constraint installed by the migration.
PURPOSE_PASSWORD_RESET = "password_reset"
# Legacy soft-verify purpose, no longer minted by any production code path.
# Pre-creation email confirmation (see services/registration.py) holds the
# token directly on `pending_registrations.token_hash` and bypasses this
# table entirely. The constant + CHECK value are retained for the
# cross-purpose rejection regression test in test_auth_recovery.py — the
# DB CHECK is the test's "non-`password_reset`" anchor.
PURPOSE_EMAIL_VERIFICATION = "email_verification"
ALL_PURPOSES = (PURPOSE_PASSWORD_RESET, PURPOSE_EMAIL_VERIFICATION)


class AuthToken(Base):
    """One row per outstanding password-reset / email-verification token.

    The raw secret is never stored — only `sha256(secret)` lands in
    `token_hash`. A DB read therefore reveals which users have outstanding
    tokens and when they expire, but not the live values that would let a
    reader log in or reset a password.

    Single-use: `consume` flips `consumed_at`. The router refuses any
    token whose row already has a non-null `consumed_at`.
    """

    __tablename__ = "auth_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_auth_tokens_user_id", "user_id"),
        Index("ix_auth_tokens_user_purpose", "user_id", "purpose"),
        Index(
            "ix_auth_tokens_live_expires_at",
            "expires_at",
            postgresql_where="consumed_at IS NULL",
        ),
    )
