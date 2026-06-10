import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Follow(Base):
    """One directed edge of the social graph — ``follower`` follows ``followed``.

    PK is the pair ``(follower_id, followed_id)`` so duplicates can't exist and
    the forward lookup ("who is X following?") rides the PK's leading column. A
    separate index on ``followed_id`` covers the reverse ("who follows X?"). The
    ``CHECK`` blocks self-follow at the DB layer — the router 400s it too, but
    the constraint is the durable invariant.

    No ORM ``relationship`` is declared: current queries hit ``follower_id`` /
    ``followed_id`` directly (counts, the ``Follow.follower_id == ...`` filters),
    so backrefs would only bloat the ``User`` mapper without serving a read path.
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
