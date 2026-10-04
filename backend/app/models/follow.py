import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Follow(Base):
    """One directed edge of the social graph: ``follower`` follows ``followed``.

    The pair PK blocks duplicates and serves "who is X following?"; an index on
    ``followed_id`` serves the reverse. The ``CHECK`` blocks self-follow (the
    router 400s it too).

    No ORM ``relationship``: queries hit the FK columns directly, and backrefs
    would only bloat the ``User`` mapper.
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
