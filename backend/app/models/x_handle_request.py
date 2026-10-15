import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# ``pending`` waits for an admin. An approval deletes the row, so ``declined``
# is the only decided state a row keeps. Value-domain source of truth for the
# column and the generated frontend type; ``ck_x_handle_requests_status_valid``
# pins it at the DB.
XHandleRequestStatus = Literal["pending", "declined"]


class XHandleRequest(Base):
    """An analyst's request that an admin bind ``x_handle`` to their account.

    One row per analyst (``user_id`` is UNIQUE): a new request replaces the
    previous one, pending or declined. The row's ``id`` changes on each
    replacement, so an admin decision names the exact request the admin read.
    """

    __tablename__ = "x_handle_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # Normalized by ``schemas/admin.normalize_x_handle``, like ``users.x_handle``.
    x_handle: Mapped[str] = mapped_column(String(50), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[XHandleRequestStatus] = mapped_column(
        String(20), nullable=False, default="pending"
    )
    decline_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user = relationship("User")

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'declined')",
            name="ck_x_handle_requests_status_valid",
        ),
        CheckConstraint(
            "(status = 'declined') = (decline_reason IS NOT NULL AND decided_at IS NOT NULL)",
            name="ck_x_handle_requests_decision_stamp",
        ),
    )
