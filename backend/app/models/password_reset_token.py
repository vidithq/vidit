import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime]
    consumed_at: Mapped[datetime | None]
    created_at: Mapped[CreatedAt]

    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_password_reset_tokens_token_hash"),
        Index("ix_password_reset_tokens_user_id", "user_id"),
        Index(
            "ix_password_reset_tokens_live_expires_at",
            "expires_at",
            postgresql_where="consumed_at IS NULL",
        ),
    )
