import uuid
from typing import Any, Literal

from sqlalchemy import ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UpdatedAt, literal_check

ApprovalRequestAudience = Literal["following", "everyone", "nobody"]
# Mirrored by the frontend's lib/approvalRequests APPROVAL_REQUEST_AUDIENCE_DEFAULT; change both.
APPROVAL_REQUEST_AUDIENCE_DEFAULT: ApprovalRequestAudience = "following"


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    notification_overrides: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default="{}"
    )
    display: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    approval_request_audience: Mapped[ApprovalRequestAudience] = mapped_column(
        String(20),
        default=APPROVAL_REQUEST_AUDIENCE_DEFAULT,
        server_default=text(f"'{APPROVAL_REQUEST_AUDIENCE_DEFAULT}'"),
    )
    updated_at: Mapped[UpdatedAt]

    __table_args__ = (
        literal_check(
            "approval_request_audience",
            ApprovalRequestAudience,
            "ck_user_preferences_approval_request_audience_valid",
        ),
    )
