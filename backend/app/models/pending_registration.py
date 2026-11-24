import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt


class PendingRegistration(Base):
    __tablename__ = "pending_registrations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(50))
    password_hash: Mapped[str] = mapped_column(String(255))
    invite_code_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invite_codes.id", ondelete="CASCADE")
    )
    token_hash: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime]
    created_at: Mapped[CreatedAt]

    __table_args__ = (
        UniqueConstraint("email", name="uq_pending_registrations_email"),
        UniqueConstraint("username", name="uq_pending_registrations_username"),
        UniqueConstraint("token_hash", name="uq_pending_registrations_token_hash"),
        Index("ix_pending_registrations_expires_at", "expires_at"),
    )
