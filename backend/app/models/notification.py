import uuid
from datetime import UTC, datetime
from typing import Literal, get_args

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
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
    # Set when the feed shows this row to its recipient; NULL is unread. Per
    # row rather than one marker: ``created_at`` is stamped at flush, and an
    # action that commits late would otherwise land behind a marker already
    # moved past it.
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    actor = relationship("User", foreign_keys=[actor_id])
    event = relationship("Event")

    __table_args__ = (
        CheckConstraint(
            "kind IN ('request_fulfilled', 'new_follower')",
            name="ck_notifications_kind_valid",
        ),
        # The feed walk, newest first per recipient.
        Index("ix_notifications_user_created_at", "user_id", "created_at", "id"),
        # The unread count.
        Index(
            "ix_notifications_user_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
        # Back the cascades of a hard-deleted actor or event.
        Index("ix_notifications_actor_id", "actor_id"),
        Index("ix_notifications_event_id", "event_id"),
    )


# ``queued``: waiting for the worker. ``sending``: claimed, the provider call
# under way or its outcome unknown; never retried, it turns ``failed`` once
# stale. ``sent``: the provider accepted it. ``failed``: refused past the
# attempt budget, or stale in ``sending``. ``skipped``: dropped unsent (the
# switch went off, the address went away, the item was hidden, or it aged out
# in the queue).
NotificationDeliveryStatus = Literal["queued", "sending", "sent", "failed", "skipped"]


class NotificationDelivery(Base):
    """One notification to deliver on one channel, written beside the
    ``Notification`` row when the recipient's switch for that kind is on.

    The worker drains the queue (``services/notification_delivery``), so a send
    happens after the action commits and never inside it.
    """

    __tablename__ = "notification_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    notification_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[NotificationChannel] = mapped_column(String(20), nullable=False)
    status: Mapped[NotificationDeliveryStatus] = mapped_column(
        String(10), nullable=False, default="queued"
    )
    # Provider refusals so far; the row fails at ``MAX_ATTEMPTS``.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # The latest claim: the stale clock while ``sending``, the retry clock once
    # a refusal puts the row back in ``queued``.
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    notification = relationship("Notification")

    __table_args__ = (
        CheckConstraint("channel IN ('email')", name="ck_notification_deliveries_channel_valid"),
        CheckConstraint(
            "status IN ('queued', 'sending', 'sent', 'failed', 'skipped')",
            name="ck_notification_deliveries_status_valid",
        ),
        UniqueConstraint("notification_id", "channel", name="uq_notification_deliveries_channel"),
        # The claim walk, oldest first.
        Index(
            "ix_notification_deliveries_queued",
            "created_at",
            postgresql_where="status = 'queued'",
        ),
        # The daily cap counts.
        Index(
            "ix_notification_deliveries_sent_at",
            "sent_at",
            postgresql_where="status = 'sent'",
        ),
    )
