import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Event names. Plain strings (not a DB enum) so a new kind needs no migration;
# the log is append-only and query-on-read, only the writer must agree on spelling.
EVENT_LOGIN = "login"
EVENT_FAILED_LOGIN = "failed_login"
EVENT_LOGOUT = "logout"
EVENT_REGISTER_PENDING = "register_pending"
EVENT_REGISTER_RESENT = "register_resent"
EVENT_REGISTER_CONFIRMED = "register_confirmed"
EVENT_PASSWORD_RESET_REQUESTED = "password_reset_requested"
EVENT_PASSWORD_RESET_COMPLETED = "password_reset_completed"
EVENT_PASSWORD_CHANGED = "password_changed"
# X OAuth ("Continue with X"): an owner claims a machine-assembled profile,
# links a handle to an existing account, or registers a new X-only account.
# (Signing in with X to an already-claimed profile reuses ``EVENT_LOGIN``.)
EVENT_X_OAUTH_CLAIM = "x_oauth_claim"
EVENT_X_LINKED = "x_linked"
EVENT_X_REGISTERED = "x_registered"


class AuthEvent(Base):
    """Append-only audit row for auth-relevant events.

    Forensics primitive — knowing nothing happened is the precondition for
    spotting when something does. Populated synchronously in the auth service
    paths via `services.audit.log_auth_event`, which swallows its own errors so
    a logging failure never breaks login.

    Sibling to `admin_events`; kept separate because admin actions carry a
    structured `target` (entity id + kind) auth events don't, and one row type
    carrying both shapes queries cleanly for neither.
    """

    __tablename__ = "auth_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    event: Mapped[str] = mapped_column(Text, nullable=False)
    # INET stores IPv4/IPv6 in native sizes (4/16 bytes) and makes subnet/
    # containment queries trivial (e.g. "any failed_login from this /24 last hour").
    ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        # "What did user X do, latest first?" — dominant forensics query.
        # user_id leads because event-without-user is rare (only failed_login
        # on an unknown email).
        Index("ix_auth_events_user_id_created_at", "user_id", "created_at"),
        # "Any spike of failed_login in the last hour?" — second-most-common.
        Index("ix_auth_events_event_created_at", "event", "created_at"),
    )
