import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EventApproval(Base):
    """A dated attestation that one version of a published event holds.

    Bound to ``(event_id, version_no)``. It is current while ``version_no`` is
    the event's live version, so a new version ends it without a write and the
    row stays readable on the version it covered. Final: nobody revokes it. The
    row is deleted when its reviewer joins the event's geolocators, or by a
    site admin (``services/approvals``).

    With ``organization_id`` set, the approval is the organization's and
    ``reviewer_id`` is the member who placed it in its name, NULL once that
    account is erased. An analyst's own
    approval and an approval they place for an organization are separate rows.
    """

    __tablename__ = "event_approvals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # The analyst who placed it. An analyst's own approval goes with their erased account
    # (``admin.hard_delete_user`` deletes it first); an organization's stays the organization's,
    # so SET NULL, and ``ck_event_approvals_reviewer`` keeps it on organization rows only.
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    reviewer = relationship("User", foreign_keys=[reviewer_id])
    organization = relationship("Organization")
    event = relationship("Event")

    __table_args__ = (
        CheckConstraint(
            "reviewer_id IS NOT NULL OR organization_id IS NOT NULL",
            name="ck_event_approvals_reviewer",
        ),
        # One approval per analyst and version: with only the live version open to
        # a review, this is also one current approval per analyst and event. The
        # leading pair serves the per-version read.
        Index(
            "uq_event_approvals_analyst",
            "event_id",
            "version_no",
            "reviewer_id",
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
        ),
        # One approval per organization and version.
        Index(
            "uq_event_approvals_organization",
            "event_id",
            "version_no",
            "organization_id",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        # The organization page's list, and the cascade of a deleted organization.
        Index(
            "ix_event_approvals_organization_created_at",
            "organization_id",
            "created_at",
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
        # Backs the cascade of an erased reviewer.
        Index("ix_event_approvals_reviewer_id", "reviewer_id"),
    )
