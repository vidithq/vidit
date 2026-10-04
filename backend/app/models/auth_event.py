import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Event names: plain strings (not a DB enum) so a new kind needs no migration;
# only the writer must agree on spelling.
EVENT_LOGIN = "login"
EVENT_FAILED_LOGIN = "failed_login"
EVENT_LOGOUT = "logout"
EVENT_REGISTER_PENDING = "register_pending"
EVENT_REGISTER_RESENT = "register_resent"
EVENT_REGISTER_CONFIRMED = "register_confirmed"
EVENT_PASSWORD_RESET_REQUESTED = "password_reset_requested"
EVENT_PASSWORD_RESET_COMPLETED = "password_reset_completed"
EVENT_PASSWORD_CHANGED = "password_changed"


class AuthEvent(Base):
    """Append-only audit row for auth-relevant events.

    Written in the auth service paths via `services.audit.log_auth_event`,
    which swallows its own errors so logging never breaks login. Sibling to
    `admin_events`, kept separate because admin actions carry a structured
    `target` that auth events don't.
    """

    __tablename__ = "auth_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event: Mapped[str] = mapped_column(Text, nullable=False)
    # No IP / User-Agent columns (privacy); network context lives at the Cloudflare edge.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        # "What did user X do, latest first?" user_id leads because a NULL user
        # is rare (failed_login on an unknown email).
        Index("ix_auth_events_user_id_created_at", "user_id", "created_at"),
        # "Any spike of failed_login in the last hour?"
        Index("ix_auth_events_event_created_at", "event", "created_at"),
    )
