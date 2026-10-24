import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Account actions: plain strings (not a DB enum) so a new action needs no
# migration; only the writer must agree on spelling. Admin actions name
# themselves at their call site (``services/admin.log_admin_event``).
ACTION_LOGIN = "login"
ACTION_FAILED_LOGIN = "failed_login"
ACTION_LOGOUT = "logout"
ACTION_REGISTER_PENDING = "register_pending"
ACTION_REGISTER_RESENT = "register_resent"
ACTION_REGISTER_CONFIRMED = "register_confirmed"
ACTION_PASSWORD_RESET_REQUESTED = "password_reset_requested"
ACTION_PASSWORD_RESET_COMPLETED = "password_reset_completed"
ACTION_PASSWORD_CHANGED = "password_changed"


class AuditLog(Base):
    """Append-only audit row: one action, by one account, on an optional target.

    ``actor_id`` is the account that acted: the site admin, the sponsor, or the
    account itself for an account action; NULL for a failed login on an
    unknown email, and once the account is erased. ``target`` names what an
    action touched, NULL for an action on one's own account. No IP or
    User-Agent is stored, for privacy.
    """

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        # "What did this account do, latest first?", and the SET NULL of an erased account.
        Index("ix_audit_log_actor_id_created_at", "actor_id", "created_at"),
        # "Any spike of failed_login in the last hour?"
        Index("ix_audit_log_action_created_at", "action", "created_at"),
    )
