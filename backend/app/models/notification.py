import uuid
from datetime import UTC, datetime
from typing import Literal, get_args

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# What happened, one value per emitter. Value-domain source of truth: the ORM
# column, the Read schemas and the generated frontend type derive from it, and
# ``ck_notifications_kind_valid`` pins it at the DB (keep the two in step).
NotificationKind = Literal["request_fulfilled", "new_follower"]

# A delivery channel besides the in-app feed, which is always on.
NotificationChannel = Literal["email"]

# The kind registry: every kind with its per-channel default. Analysts store
# only overrides (``user_preferences.notification_overrides``), so changing a
# default here moves everyone who never touched that switch.
NOTIFICATION_KINDS: dict[NotificationKind, dict[NotificationChannel, bool]] = {
    "request_fulfilled": {"email": True},
    "new_follower": {"email": False},
}
assert set(NOTIFICATION_KINDS) == set(get_args(NotificationKind))


class Notification(Base):
    """One thing that happened to ``user_id``, written in the transaction of the
    action that caused it.

    The typed FKs name what the row points at. Each one cascades, so a
    hard-deleted target takes its rows with it. Soft deletes and takedowns are
    filtered at read time (``services/notifications``), so a row hides when its
    event or actor goes and shows again if that is undone.
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[NotificationKind] = mapped_column(String(40), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    actor = relationship("User", foreign_keys=[actor_id])
    event = relationship("Event")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('request_fulfilled', 'new_follower')",
            name="ck_notifications_kind_valid",
        ),
        # The feed walk and the unread count, both newest first per recipient.
        Index("ix_notifications_user_created_at", "user_id", "created_at", "id"),
        # Back the cascades of a hard-deleted actor or event.
        Index("ix_notifications_actor_id", "actor_id"),
        Index("ix_notifications_event_id", "event_id"),
    )
