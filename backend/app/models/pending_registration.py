import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PendingRegistration(Base):
    """A registration submitted but not yet email-confirmed.

    ``/auth/register`` parks the identity here and emails a link; the ``users``
    row is created only on click, re-validating invite and uniqueness in one
    transaction. Only ``sha256(secret)`` is stored in ``token_hash``, so a
    read-only DB leak cannot mint accounts.

    ``email`` / ``username`` use a plain UNIQUE, not a partial index, because
    ``expires_at > now()`` is STABLE and partial-index predicates must be
    IMMUTABLE. The create path deletes expired rows first and the reaper sweeps
    the rest.
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
