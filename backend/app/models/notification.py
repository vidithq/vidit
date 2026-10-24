import uuid
from datetime import UTC, datetime
from typing import Literal, get_args

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check

# What happened, one value per emitter. Value-domain source of truth: the ORM
# column, the Read schemas and the generated frontend type derive from it, and
# ``ck_notifications_kind_valid`` pins it at the DB (keep the two in step).
NotificationKind = Literal[
    "request_fulfilled",
    "new_follower",
    "x_handle_request_approved",
    "x_handle_request_declined",
    "co_geolocator_invite",
    "co_geolocator_removed",
    "ownership_transferred",
    "organization_invite",
    "organization_invite_accepted",
    "organization_manager_inherited",
    "re_approve_requested",
    "approval_received",
    "approval_revoked",
    "approval_request_received",
    "approval_request_declined",
    "organization_approval_removed",
]

# The kind registry: every kind with its email default. The in-app feed always
# shows every kind. Analysts store only overrides
# (``user_preferences.notification_overrides``), so changing a default here
# moves everyone who never touched that switch.
NOTIFICATION_KINDS: dict[NotificationKind, bool] = {
    "request_fulfilled": True,
    "new_follower": False,
    "x_handle_request_approved": True,
    "x_handle_request_declined": True,
    "co_geolocator_invite": True,
    "co_geolocator_removed": False,
    "ownership_transferred": True,
    "organization_invite": True,
    "organization_invite_accepted": False,
    "organization_manager_inherited": True,
    "re_approve_requested": False,
    "approval_received": False,
    "approval_revoked": False,
    "approval_request_received": True,
    "approval_request_declined": False,
    "organization_approval_removed": False,
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
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    # The name of an organization the row speaks of once it is gone: an
    # ``organization_approval_removed`` row outlives the organization it names.
    organization_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # The approval an ``approval_received`` row reports: the feed hides the row once it is
    # revoked.
    approval_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("event_approvals.id", ondelete="CASCADE"), nullable=True
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
    organization = relationship("Organization")
    approval = relationship("EventApproval")

    __table_args__ = (
        literal_check("kind", NotificationKind, "ck_notifications_kind_valid"),
        # The feed walk, newest first per recipient.
        Index("ix_notifications_user_created_at", "user_id", "created_at", "id"),
        # The unread count.
        Index(
            "ix_notifications_user_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
        # Back the cascades of a hard-deleted actor, event, organization or approval.
        Index("ix_notifications_actor_id", "actor_id"),
        Index("ix_notifications_event_id", "event_id"),
        Index("ix_notifications_organization_id", "organization_id"),
        Index(
            "ix_notifications_approval_id",
            "approval_id",
            postgresql_where=text("approval_id IS NOT NULL"),
        ),
    )


# ``queued``: waiting for the worker. ``sending``: claimed, the provider call
# under way or its outcome unknown; never retried, it turns ``failed`` once
# stale. ``sent``: the provider accepted it. ``failed``: refused past the
# attempt budget, or stale in ``sending``. ``skipped``: dropped unsent (the
# switch or consent went off, the address went away, the item was hidden, or
# it aged out in the queue).
NotificationDeliveryStatus = Literal["queued", "sending", "sent", "failed", "skipped"]


# What a channel sender reports for one row. ``sent``: the provider took it.
# ``skipped``: nothing to send it to. ``refused``: a definite refusal, retried.
# ``unknown``: it may have gone out, so the row stays ``sending`` and is never
# retried.
DeliveryOutcome = Literal["sent", "skipped", "refused", "unknown"]


class DeliveryState:
    """The send state of one row of a queue the worker drains
    (``services/notification_delivery.deliver``)."""

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
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


class NotificationDelivery(DeliveryState, Base):
    """One notification to email, written beside the ``Notification`` row when
    the recipient's email switch for that kind is on.

    The worker drains the queue (``services/notification_delivery``), so a send
    happens after the action commits and never inside it.
    """

    __tablename__ = "notification_deliveries"

    # SET NULL: a deleted notification leaves its sent rows behind for the daily
    # email cap (``services/notifications.delete`` removes the unsent ones).
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True
    )

    notification = relationship("Notification")

    __table_args__ = (
        literal_check(
            "status", NotificationDeliveryStatus, "ck_notification_deliveries_status_valid"
        ),
        UniqueConstraint("notification_id", name="uq_notification_deliveries_notification_id"),
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
