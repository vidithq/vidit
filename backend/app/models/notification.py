import uuid
from datetime import datetime
from typing import Literal, get_args

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, literal_check

NotificationKind = Literal[
    "request_fulfilled",
    "new_follower",
    "co_geolocator_invite",
    "co_geolocator_removed",
    "ownership_transferred",
    "organization_invite",
    "organization_invite_accepted",
    "organization_manager_inherited",
    "re_approve_requested",
    "approval_received",
    "approval_request_received",
    "approval_request_declined",
    "organization_approval_removed",
]

NOTIFICATION_KINDS: dict[NotificationKind, bool] = {
    "request_fulfilled": True,
    "new_follower": False,
    "co_geolocator_invite": True,
    "co_geolocator_removed": False,
    "ownership_transferred": True,
    "organization_invite": True,
    "organization_invite_accepted": False,
    "organization_manager_inherited": True,
    "re_approve_requested": False,
    "approval_received": False,
    "approval_request_received": True,
    "approval_request_declined": False,
    "organization_approval_removed": False,
}
assert set(NOTIFICATION_KINDS) == set(get_args(NotificationKind))


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[NotificationKind] = mapped_column(String(40))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )
    organization_name: Mapped[str | None] = mapped_column(String(100))
    approval_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("event_approvals.id", ondelete="CASCADE")
    )
    created_at: Mapped[CreatedAt]
    read_at: Mapped[datetime | None]

    actor = relationship("User", foreign_keys=[actor_id])
    event = relationship("Event")
    organization = relationship("Organization")
    approval = relationship("EventApproval")

    __table_args__ = (
        literal_check("kind", NotificationKind, "ck_notifications_kind_valid"),
        Index("ix_notifications_user_created_at", "user_id", "created_at", "id"),
        Index(
            "ix_notifications_user_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
        Index("ix_notifications_actor_id", "actor_id"),
        Index("ix_notifications_event_id", "event_id"),
        Index("ix_notifications_organization_id", "organization_id"),
        Index(
            "ix_notifications_approval_id",
            "approval_id",
            postgresql_where=text("approval_id IS NOT NULL"),
        ),
    )


NotificationDeliveryStatus = Literal["queued", "running", "done", "failed", "skipped"]


# What the sender reports for one row. ``sent``: the provider took it.
# ``skipped``: nothing to send it to. ``refused``: a definite refusal, retried.
# ``unknown``: it may have gone out, so the row stays ``running`` and is never
# retried.
DeliveryOutcome = Literal["sent", "skipped", "refused", "unknown"]


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    status: Mapped[NotificationDeliveryStatus] = mapped_column(String(10), default="queued")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[CreatedAt]
    claimed_at: Mapped[datetime | None]
    sent_at: Mapped[datetime | None]
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("notifications.id", ondelete="SET NULL")
    )

    notification = relationship("Notification")

    __table_args__ = (
        literal_check(
            "status", NotificationDeliveryStatus, "ck_notification_deliveries_status_valid"
        ),
        UniqueConstraint("notification_id", name="uq_notification_deliveries_notification_id"),
        Index(
            "ix_notification_deliveries_queued",
            "created_at",
            postgresql_where="status = 'queued'",
        ),
        Index(
            "ix_notification_deliveries_sent_at",
            "sent_at",
            postgresql_where="status = 'done'",
        ),
    )
