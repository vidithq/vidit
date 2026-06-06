import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Follow(Base):
    """One directed edge of the social graph — ``follower`` follows ``followed``.

    Primary key is the pair ``(follower_id, followed_id)`` so duplicate rows
    can't exist and the forward-direction lookup ("who is X following?") is
    indexed by the PK's leading column. A separate index on ``followed_id``
    covers the reverse-direction lookup ("who follows X?"). A ``CHECK``
    constraint blocks self-follow at the DB layer — the router rejects it
    with a 400 too, but the constraint is the durable invariant.

    No ORM ``relationship`` is declared on this model: slice-1 queries hit
    ``follower_id`` / ``followed_id`` directly (``followers_count``,
    ``following_count``, the ``Follow.follower_id == ...`` filters), so
    convenience backrefs would only bloat the ``User`` mapper without
    serving any read path. Add them back when slice 2 introduces
    follower-list pages and the join is genuinely useful.
    """

    __tablename__ = "follows"

    follower_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    followed_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("follower_id <> followed_id", name="ck_follows_no_self_follow"),
        Index("ix_follows_followed_id", "followed_id"),
    )
