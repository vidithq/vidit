import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Event names. Kept as plain strings (not a DB enum) so adding a new
# kind doesn't require a migration — the audit log is append-only and
# query-on-read, the writer is the only thing that needs to agree on
# spelling.
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

    Forensics primitive — knowing nothing happened is the precondition
    for spotting when something does. Populated synchronously inside the
    auth service paths via `services.audit.log_auth_event`, which
    swallows its own errors so a logging failure never breaks login.

    Sibling to `admin_events`; the two schemas overlap enough that they
    may eventually merge. Kept separate for now because admin actions
    carry a structured `target` (entity id + kind) that auth events do
    not, and forcing one row type to carry both shapes makes neither
    query convenient.
    """

    __tablename__ = "auth_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event: Mapped[str] = mapped_column(Text, nullable=False)
    # INET stores IPv4 and IPv6 in their native sizes (4 / 16 bytes) and
    # makes subnet / containment queries trivial — useful when
    # investigating "any failed_login from this /24 in the last hour".
    ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        # "What did user X do, latest first?" — the dominant forensics
        # query. user_id ordered first because event-without-user is rare
        # (only failed_login on an unknown email).
        Index("ix_auth_events_user_id_created_at", "user_id", "created_at"),
        # "Any spike of failed_login in the last hour?" — second-most-
        # common query path.
        Index("ix_auth_events_event_created_at", "event", "created_at"),
    )
