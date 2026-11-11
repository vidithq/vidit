import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt


class InviteCode(Base):
    __tablename__ = "invite_codes"
    __table_args__ = (
        Index("ix_invite_codes_created_by_id_created_at", "created_by_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    used_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    used_at: Mapped[datetime | None]
    expires_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]
    x_handle: Mapped[str | None] = mapped_column(String(50))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[CreatedAt]

    used_by_user = relationship("User", foreign_keys=[used_by_id])
    created_by_user = relationship("User", foreign_keys=[created_by_id])
