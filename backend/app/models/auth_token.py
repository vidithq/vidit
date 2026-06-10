import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Single source of truth for `purpose` values. Mirrored in the migration's CHECK.
PURPOSE_PASSWORD_RESET = "password_reset"
# Legacy soft-verify purpose, no longer minted by any production path:
# pre-creation email confirmation holds the token on
# `pending_registrations.token_hash` and bypasses this table. Constant + CHECK
# value retained as the "non-`password_reset`" anchor for the cross-purpose
# rejection regression test in test_auth_recovery.py.
PURPOSE_EMAIL_VERIFICATION = "email_verification"
ALL_PURPOSES = (PURPOSE_PASSWORD_RESET, PURPOSE_EMAIL_VERIFICATION)


class AuthToken(Base):
    """One row per outstanding password-reset / email-verification token.

    The raw secret is never stored — only `sha256(secret)` lands in
    `token_hash`. A DB read reveals which users have outstanding tokens and
    when they expire, but not the live values needed to log in or reset.

    Single-use: `consume` flips `consumed_at`; the router refuses any token
    whose row already has a non-null `consumed_at`.
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
