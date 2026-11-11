import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt


class Follow(Base):
    # No ORM ``relationship``: queries hit the FK columns directly, and backrefs
    # would only bloat the ``User`` mapper.

    __tablename__ = "follows"

    follower_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    followed_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[CreatedAt]

    __table_args__ = (
        CheckConstraint("follower_id <> followed_id", name="ck_follows_no_self_follow"),
        Index("ix_follows_followed_id", "followed_id"),
    )
