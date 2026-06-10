import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PendingRegistration(Base):
    """A registration submitted but not yet email-confirmed.

    Pre-creation email verification: ``/auth/register`` parks the identity here
    and emails a confirmation link. The ``users`` row is created only when the
    user clicks the link and we re-validate invite + uniqueness in one transaction.

    The raw token is never stored — only ``sha256(secret)`` lands in
    ``token_hash`` (hash-at-rest like ``auth_tokens``), so a read-only DB leak
    cannot mint accounts.

    Uniqueness on ``email``/``username`` is a plain UNIQUE constraint, not a
    partial index, because Postgres requires partial-index predicates to be
    IMMUTABLE and ``expires_at > now()`` is STABLE. The create path deletes
    expired rows before inserting and the reaper sweeps the rest, so a
    recently-expired row doesn't permanently pin its address.
    """

    __tablename__ = "pending_registrations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    invite_code_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invite_codes.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
