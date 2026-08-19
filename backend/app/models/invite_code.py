import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # The account that redeemed the code. Audit-only, and nulled when that
    # account is erased (ON DELETE SET NULL), so it is not the redemption
    # marker: ``used_at`` is, and it outlives the account.
    used_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Stamped at redemption. Every code is single-use, so a non-NULL value is
    # what makes the code spent.
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The X handle this invite binds (normalized: lowercase, no leading `@`).
    # Set at mint time by the admin; redemption copies it onto the new
    # account's `users.x_handle` so the bot can attribute that handle's
    # mentions. Delivery of the code over X DM to that handle is the
    # possession proof during the beta. Fail-soft on redemption: if the handle
    # was taken meanwhile, the account is still created, without the link.
    x_handle: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    used_by_user = relationship("User", foreign_keys=[used_by])
