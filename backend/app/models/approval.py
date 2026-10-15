import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# What a review says. Value-domain source of truth for the column and the Read
# schema; ``ck_event_approvals_verdict_valid`` pins it at the DB (keep the two
# in step).
ApprovalVerdict = Literal["approve"]


class EventApproval(Base):
    """A dated attestation that one version of a published event holds.

    Bound to ``(event_id, version_no)``. It is current while ``version_no`` is
    the event's live version and ``revoked_at`` is NULL, so a new version ends
    it without a write and the row stays readable on the version it covered.
    Revocation stamps the row and keeps it: the reason is public.
    """

    __tablename__ = "event_approvals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # The analyst who placed it. CASCADE: an erased analyst's attestations go with the account.
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    verdict: Mapped[ApprovalVerdict] = mapped_column(
        String(20), nullable=False, default="approve", server_default=text("'approve'")
    )
    # Unbounded ``Text``; the API caps input at ``schemas/approval.APPROVAL_NOTE_MAX_LENGTH``.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SET NULL: a revocation outlives the account that made it.
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    revoke_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    reviewer = relationship("User", foreign_keys=[reviewer_id])

    __table_args__ = (
        CheckConstraint("verdict IN ('approve')", name="ck_event_approvals_verdict_valid"),
        CheckConstraint(
            "(revoked_at IS NULL) = (revoke_reason IS NULL)",
            name="ck_event_approvals_revoke_reason",
        ),
        # One review per analyst and version: with only the live version open to a
        # review, this is also one current approval per analyst and event. The
        # leading pair serves the per-version read.
        UniqueConstraint(
            "event_id",
            "version_no",
            "reviewer_id",
            name="uq_event_approvals_event_version_reviewer",
        ),
        # Back the cascade of an erased reviewer and the SET NULL of a revoker.
        Index("ix_event_approvals_reviewer_id", "reviewer_id"),
        Index(
            "ix_event_approvals_revoked_by_id",
            "revoked_by_id",
            postgresql_where=text("revoked_by_id IS NOT NULL"),
        ),
    )
