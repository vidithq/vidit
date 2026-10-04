import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Source of truth for `purpose` values; mirrored in the migration's CHECK.
PURPOSE_PASSWORD_RESET = "password_reset"
ALL_PURPOSES = (PURPOSE_PASSWORD_RESET,)


class AuthToken(Base):
    """One row per outstanding password-reset token.

    Only `sha256(secret)` is stored in `token_hash`, so a DB read reveals who
    holds tokens but not live values. Single-use: `consume` flips
    `consumed_at`, and the router refuses a non-null one.
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
