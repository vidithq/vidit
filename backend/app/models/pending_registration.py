import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, CreatedAt


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
    email: Mapped[str] = mapped_column(String(255), unique=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    invite_code_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invite_codes.id", ondelete="CASCADE")
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime]
    created_at: Mapped[CreatedAt]
