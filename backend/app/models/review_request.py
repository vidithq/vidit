import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Where a request stands. Value-domain source of truth for the column and the Read schema;
# ``ck_review_requests_status_valid`` pins it at the DB (keep the two in step).
ReviewRequestStatus = Literal["open", "approved", "declined"]


class ReviewRequest(Base):
    """A geolocator of an event asks an analyst to review it.

    Open until the target approves the event (any version) or declines. The row stays once
    resolved, so the requester sees the outcome. ``version_no`` is the live version when the
    request was sent.

    The target is one analyst (``target_user_id``). The column is nullable and
    ``ck_review_requests_one_target`` requires it, so an organization target can join as a
    sibling column under a widened check.
    """

    __tablename__ = "review_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    status: Mapped[ReviewRequestStatus] = mapped_column(
        String(20), nullable=False, default="open", server_default=text("'open'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    requester = relationship("User", foreign_keys=[requester_id])
    target_user = relationship("User", foreign_keys=[target_user_id])

    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'approved', 'declined')", name="ck_review_requests_status_valid"
        ),
        CheckConstraint(
            "(status = 'open') = (resolved_at IS NULL)", name="ck_review_requests_resolved"
        ),
        CheckConstraint("target_user_id IS NOT NULL", name="ck_review_requests_one_target"),
        # One open request per requester, target and event.
        Index(
            "uq_review_requests_open",
            "event_id",
            "target_user_id",
            "requester_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
        # The target's open requests, and the cascade of an erased target.
        Index("ix_review_requests_target_user_id", "target_user_id", "status"),
        # The requester's daily cap, and the cascade of an erased requester.
        Index("ix_review_requests_requester_created_at", "requester_id", "created_at"),
    )
