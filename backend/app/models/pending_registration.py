import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PendingRegistration(Base):
    """A registration that has been submitted but not yet email-confirmed.

    Pre-creation email verification: ``/auth/register`` puts the
    submitted identity here and emails a confirmation link. The ``users``
    row is only created when the user clicks the link and we re-validate
    the invite + uniqueness in the same transaction.

    The raw confirmation token is never stored — only ``sha256(secret)``
    lands in ``token_hash``. Same hash-at-rest pattern as
    ``auth_tokens`` so a read-only DB leak cannot mint accounts.

    Uniqueness on ``email`` and ``username`` is a plain UNIQUE
    constraint, not a partial index, because Postgres requires partial-
    index predicates to be IMMUTABLE and ``expires_at > now()`` is
    STABLE. The create path deletes expired rows before inserting, and
    the reaper sweeps the rest, so a recently-expired pending
    registration does not permanently pin its address.
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
