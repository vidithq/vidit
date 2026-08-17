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
    # Nullable for historical credential-less rows (the retired assembled-
    # profile mechanism minted users from an X handle alone); every account
    # created today carries both, set by the registration flow.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The X handle the bot attributes mentions to, stored lowercased without
    # the leading `@`. Two write paths, neither self-serve: registration copies
    # an invite-bound handle, and `PATCH /admin/users/{id}/x-handle` repairs
    # or backfills (verify-by-post linking is a later gate).
    # UNIQUE: one account per handle. Distinct from `external_links["x"]`, a
    # free-text display link the owner sets; this is the attribution anchor.
    x_handle: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Deliberate audit stamp: written once by the registration flow, read by no
    # code path. A ``users`` row exists only because the analyst clicked the
    # confirmation link, so this is non-NULL for any row minted after the
    # pending_registrations migration; legacy rows (pre-cutover, never verified)
    # may hold NULL. Keep it: it is the record of when email control was proven.
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
    # Monotonic session-invalidation counter. The session JWT embeds it as a
    # `tv` claim at mint time and `get_current_user` 401s on mismatch. Bumped on
    # logout, password change, password reset, and soft-delete so all
    # outstanding sessions die at once — clearing the cookie alone doesn't
    # invalidate the token.
    token_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    # Public profile fields. Bio is plain text (no Tiptap, no inline media: a
    # short signal, not a post), opt-in via PATCH /users/me.
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Server-minted, never a value the owner types: PUT /users/me/avatar stores
    # one stripped 400 px JPEG under `avatars/<user id>/` and writes its public
    # URL here, DELETE clears both. Every viewer's browser therefore fetches
    # the picture from our own media host, so a profile field cannot become a
    # beacon that collects the IP and User-Agent of everyone who loads a page
    # the avatar appears on.
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSONB keyed by platform (x, discord, website, github). Default ``{}`` so
    # the read path is always a dict (never NULL); PATCH is wholesale-replace,
    # not deep-merge.
    external_links: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )

    events = relationship("Event", back_populates="owner", foreign_keys="Event.owner_id")
