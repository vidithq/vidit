import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, literal_check

# Who may send this analyst an approval request: analysts they follow, any signed-in analyst, or
# nobody. Value-domain source of truth; ``ck_user_preferences_approval_request_audience_valid`` pins it
# at the DB (keep the two in step).
ApprovalRequestAudience = Literal["following", "everyone", "nobody"]
# Mirrored by the frontend's lib/approvalRequests APPROVAL_REQUEST_AUDIENCE_DEFAULT; change both.
APPROVAL_REQUEST_AUDIENCE_DEFAULT: ApprovalRequestAudience = "following"


class UserPreferences(Base):
    """One analyst's stored preferences. Created on the first write; a missing
    row reads as the defaults (``services/preferences``)."""

    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # ``{kind: bool}``, email overrides of ``NOTIFICATION_KINDS`` only.
    notification_overrides: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )
    # ``{palette, theme, help_tooltips}``, each key present once written.
    display: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )
    approval_request_audience: Mapped[ApprovalRequestAudience] = mapped_column(
        String(20),
        default=APPROVAL_REQUEST_AUDIENCE_DEFAULT,
        server_default=text(f"'{APPROVAL_REQUEST_AUDIENCE_DEFAULT}'"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        literal_check(
            "approval_request_audience",
            ApprovalRequestAudience,
            "ck_user_preferences_approval_request_audience_valid",
        ),
    )
