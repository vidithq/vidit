import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Value-domain source of truth for a member's role: the ORM column, the Read
# schemas and the generated frontend type derive from it, and
# ``ck_organization_members_role_valid`` pins it at the DB (keep the two in step).
OrganizationRole = Literal["admin", "member"]


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
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )


class OrganizationMember(Base):
    """One analyst's membership. The pair PK keeps one role per analyst and
    organization; an index on ``user_id`` serves "which organizations is X in?"."""

    __tablename__ = "organization_members"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[OrganizationRole] = mapped_column(String(20), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    user = relationship("User")
    organization = relationship("Organization")

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'member')", name="ck_organization_members_role_valid"),
        Index("ix_organization_members_user_id", "user_id"),
    )


class OrganizationInvite(Base):
    """A pending invitation. Accepting turns it into a membership and declining
    drops it, so a row exists only while the invitee has not answered."""

    __tablename__ = "organization_invites"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    invited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    user = relationship("User", foreign_keys=[user_id])
    invited_by = relationship("User", foreign_keys=[invited_by_id])

    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_organization_invites_pair"),
        Index("ix_organization_invites_user_id", "user_id"),
    )
