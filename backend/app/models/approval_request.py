import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, literal_check

ApprovalRequestStatus = Literal["open", "approved", "declined", "withdrawn"]


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    version_no: Mapped[int] = mapped_column(Integer)
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    target_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )
    status: Mapped[ApprovalRequestStatus] = mapped_column(
        String(20), default="open", server_default=text("'open'")
    )
    created_at: Mapped[CreatedAt]
    resolved_at: Mapped[datetime | None]

    requester = relationship("User", foreign_keys=[requester_id])
    target_user = relationship("User", foreign_keys=[target_user_id])
    target_organization = relationship("Organization")
    event = relationship("Event")

    __table_args__ = (
        literal_check("status", ApprovalRequestStatus, "ck_approval_requests_status_valid"),
        CheckConstraint(
            "(status = 'open') = (resolved_at IS NULL)", name="ck_approval_requests_resolved"
        ),
        CheckConstraint(
            "num_nonnulls(target_user_id, target_organization_id) = 1",
            name="ck_approval_requests_one_target",
        ),
        Index(
            "uq_approval_requests_open",
            "event_id",
            "target_user_id",
            "requester_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
        Index(
            "uq_approval_requests_open_organization",
            "event_id",
            "target_organization_id",
            "requester_id",
            unique=True,
            postgresql_where=text("status = 'open' AND target_organization_id IS NOT NULL"),
        ),
        Index(
            "ix_approval_requests_target_organization_id",
            "target_organization_id",
            "status",
            postgresql_where=text("target_organization_id IS NOT NULL"),
        ),
        Index("ix_approval_requests_target_user_id", "target_user_id", "status"),
        Index("ix_approval_requests_requester_created_at", "requester_id", "created_at"),
    )
