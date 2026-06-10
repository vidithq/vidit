import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_trusted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Mandatory at the app layer when is_trusted=true (the trust mark must be
    # substantiated to be a useful public signal). Not DB-enforced because
    # historical rows would fight a NOT NULL.
    trust_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set to created_at by the pre-creation registration flow — a ``users`` row
    # exists only because the analyst clicked the confirmation link, so this is
    # non-NULL for any row minted after the pending_registrations migration.
    # Legacy rows (pre-cutover, never verified) may hold NULL; nothing branches
    # on it today, but the column documents the moment of email control.
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # Soft-delete: NULL = live, timestamp = removed. Login + auth checks reject
    # soft-deleted users; public reads filter `deleted_at IS NULL`. Soft-
    # deleting a user cascade-soft-deletes every geolocation they authored.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TRUE iff created by the admin "Demo data" seeder. Demo users have an
    # unloggable password and a synthetic `@vidit.invalid` email; the wipe
    # button drops every is_demo=TRUE row.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Monotonic session-invalidation counter. The session JWT embeds it as a
    # `tv` claim at mint time and `get_current_user` 401s on mismatch. Bumped on
    # logout, password change, password reset, and soft-delete so all
    # outstanding sessions die at once — clearing the cookie alone doesn't
    # invalidate the token.
    token_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    # Public profile fields, opt-in via PATCH /users/me. Bio is plain text (no
    # Tiptap, no inline media — a short signal, not a post). Avatar is a
    # free-form URL; no upload pipeline for it yet.
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSONB keyed by platform (x, discord, website, github). Default ``{}`` so
    # the read path is always a dict (never NULL); PATCH is wholesale-replace,
    # not deep-merge.
    external_links: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )

    geolocations = relationship("Geolocation", back_populates="author")
    bounties = relationship(
        "Bounty",
        back_populates="author",
        foreign_keys="Bounty.author_id",
    )
    invite_codes_created = relationship(
        "InviteCode", back_populates="creator", foreign_keys="InviteCode.created_by"
    )
