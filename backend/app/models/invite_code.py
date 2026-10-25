import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class InviteCode(Base):
    __tablename__ = "invite_codes"
    __table_args__ = (
        Index("ix_invite_codes_created_by_id_created_at", "created_by_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # The redeeming account. Audit-only, nulled on that account's erasure; the
    # redemption marker is ``used_at``, which outlives it.
    used_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Stamped at redemption; non-NULL means spent (single-use).
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The X handle this invite binds (lowercase, no `@`), set at mint. Redemption
    # copies it to `users.x_handle` so the bot can attribute its mentions.
    # Fail-soft: if the handle was taken meanwhile, the account is created
    # without the link.
    x_handle: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # The analyst who minted the code from Settings; NULL for an admin-minted code.
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    used_by_user = relationship("User", foreign_keys=[used_by_id])
    created_by_user = relationship("User", foreign_keys=[created_by_id])
