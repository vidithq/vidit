import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Who may send this analyst a review request: analysts they follow, any signed-in analyst, or
# nobody. Value-domain source of truth; ``ck_user_preferences_review_request_audience`` pins it
# at the DB (keep the two in step).
ReviewRequestAudience = Literal["following", "everyone", "nobody"]
# Mirrored by the frontend's lib/reviewRequests REVIEW_REQUEST_AUDIENCE_DEFAULT; change both.
REVIEW_REQUEST_AUDIENCE_DEFAULT: ReviewRequestAudience = "following"


class UserPreferences(Base):
    """One analyst's stored preferences. Created on the first write; a missing
    row reads as the defaults (``services/preferences``)."""

    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # ``{kind: {channel: bool}}``, overrides of ``NOTIFICATION_KINDS`` only.
    notification_overrides: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )
    # ``{palette, theme, help_tooltips}``, each key present once written.
    display: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )
    review_request_audience: Mapped[ReviewRequestAudience] = mapped_column(
        String(20),
        default=REVIEW_REQUEST_AUDIENCE_DEFAULT,
        server_default=text(f"'{REVIEW_REQUEST_AUDIENCE_DEFAULT}'"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "review_request_audience IN ('following', 'everyone', 'nobody')",
            name="ck_user_preferences_review_request_audience",
        ),
    )
