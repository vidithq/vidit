import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PushSubscription(Base):
    """One browser or installed app registered for Web Push by ``user_id``.

    ``endpoint`` is a bearer URL: whoever holds it can push to the device. It
    never appears in a log, an error report or an API response. It is unique,
    so a browser that re-registers under another account moves to that account.
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(128), nullable=False)
    auth: Mapped[str] = mapped_column(String(64), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Refusals since the last accepted push; the device is dropped at ``push.MAX_REFUSALS``.
    refusals: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )

    __table_args__ = (
        UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
        Index("ix_push_subscriptions_user_id", "user_id"),
    )
