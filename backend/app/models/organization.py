import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check
from app.models.user_preferences import APPROVAL_REQUEST_AUDIENCE_DEFAULT, ApprovalRequestAudience

# Value-domain source of truth for a member's role: the ORM column, the Read
# schemas and the generated frontend type derive from it, and
# ``ck_organization_members_role_valid`` pins it at the DB (keep the two in step).
OrganizationRole = Literal["manager", "member"]


class Organization(Base):
    """A collective with its own public profile. Only a site admin creates one
    (``POST /admin/organizations``), which keeps a name from being squatted and
    verifies ``x_handle`` by hand."""

    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # The URL key (``/organizations/<slug>``). Never changes once set, so a
    # pinned link keeps resolving.
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # The identity anchor a site admin verified, lowercased without `@`, like
    # ``users.x_handle``.
    x_handle: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Server-minted under ``avatars/<organization id>/``, like ``users.avatar_url``.
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Same keys and rules as ``users.external_links``.
    external_links: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )
    # Who may send the organization an approval request, set by its org managers. ``following``
    # admits an analyst whom at least one live org manager follows.
    approval_request_audience: Mapped[ApprovalRequestAudience] = mapped_column(
        String(20),
        default=APPROVAL_REQUEST_AUDIENCE_DEFAULT,
        server_default=text(f"'{APPROVAL_REQUEST_AUDIENCE_DEFAULT}'"),
        nullable=False,
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        literal_check(
            "approval_request_audience",
            ApprovalRequestAudience,
            "ck_organizations_approval_request_audience_valid",
        ),
    )


# Where an analyst stands in an organization. ``invited``: an org manager asked
# them to join. ``active``: a member. Declining or a withdrawal deletes the
# row, and so does leaving. ``ck_organization_members_state_valid`` pins it.
OrganizationMemberState = Literal["invited", "active"]


class OrganizationMember(Base):
    """One analyst's standing in one organization, one row per pair: a pending
    invitation, or a membership with its role. Accepting turns the row
    ``active``. An index on ``user_id`` serves "which organizations is X in?"."""

    __tablename__ = "organization_members"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The org manager who sent the invitation; NULL for an org manager a site
    # admin appointed, and once the inviter's account is erased.
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    state: Mapped[OrganizationMemberState] = mapped_column(String(20), nullable=False)
    # The role the analyst holds once ``active``; an invitation joins as ``member``.
    role: Mapped[OrganizationRole] = mapped_column(String(20), nullable=False)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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
