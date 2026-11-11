import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, literal_check
from app.models.user_preferences import APPROVAL_REQUEST_AUDIENCE_DEFAULT, ApprovalRequestAudience

OrganizationRole = Literal["manager", "member"]


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    x_handle: Mapped[str | None] = mapped_column(String(50), unique=True)
    bio: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    external_links: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    approval_request_audience: Mapped[ApprovalRequestAudience] = mapped_column(
        String(20),
        default=APPROVAL_REQUEST_AUDIENCE_DEFAULT,
        server_default=text(f"'{APPROVAL_REQUEST_AUDIENCE_DEFAULT}'"),
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[CreatedAt]

    __table_args__ = (
        literal_check(
            "approval_request_audience",
            ApprovalRequestAudience,
            "ck_organizations_approval_request_audience_valid",
        ),
    )


OrganizationMemberState = Literal["invited", "active"]


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    state: Mapped[OrganizationMemberState] = mapped_column(String(20))
    role: Mapped[OrganizationRole] = mapped_column(String(20))
    invited_at: Mapped[datetime | None]
    joined_at: Mapped[datetime | None]

    user = relationship("User", foreign_keys=[user_id])
    invited_by = relationship("User", foreign_keys=[invited_by_id])
    organization = relationship("Organization")

    __table_args__ = (
        literal_check("role", OrganizationRole, "ck_organization_members_role_valid"),
        literal_check("state", OrganizationMemberState, "ck_organization_members_state_valid"),
        CheckConstraint(
            "(state <> 'invited' OR invited_at IS NOT NULL)"
            " AND (state <> 'active' OR joined_at IS NOT NULL)",
            name="ck_organization_members_state_stamp",
        ),
        Index("ix_organization_members_user_id", "user_id"),
    )
