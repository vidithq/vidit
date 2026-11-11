import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt


class EventApproval(Base):
    __tablename__ = "event_approvals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    version_no: Mapped[int] = mapped_column(Integer)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )
    created_at: Mapped[CreatedAt]

    reviewer = relationship("User", foreign_keys=[reviewer_id])
    organization = relationship("Organization")
    event = relationship("Event")

    __table_args__ = (
        CheckConstraint(
            "reviewer_id IS NOT NULL OR organization_id IS NOT NULL",
            name="ck_event_approvals_reviewer",
        ),
        Index(
            "uq_event_approvals_analyst",
            "event_id",
            "version_no",
            "reviewer_id",
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
        ),
        Index(
            "uq_event_approvals_organization",
            "event_id",
            "version_no",
            "organization_id",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        Index(
            "ix_event_approvals_organization_created_at",
            "organization_id",
            "created_at",
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        Index("ix_event_approvals_reviewer_id", "reviewer_id"),
    )
