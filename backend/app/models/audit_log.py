import uuid
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt

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
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(Text)
    target: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[CreatedAt]

    __table_args__ = (
        Index("ix_audit_log_actor_id_created_at", "actor_id", "created_at"),
        Index("ix_audit_log_action_created_at", "action", "created_at"),
    )
