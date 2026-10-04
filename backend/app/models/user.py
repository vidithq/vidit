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
    # Nullable for historical credential-less rows; every account created today
    # carries both.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The X handle the bot attributes mentions to, lowercased without `@`.
    # Written by registration (invite-bound handle) and
    # `PATCH /admin/users/{id}/x-handle`; not self-serve. UNIQUE: one account per
    # handle. Distinct from `external_links["x"]`, a free-text display link.
    x_handle: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Audit stamp written once by registration, read by no code path: when email
    # control was proven. Legacy rows may hold NULL.
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # Most recent authenticated request, throttled: ``dependencies.get_current_user``
    # refreshes it once per ``LAST_SEEN_THROTTLE`` window; login and
    # register-confirm stamp it too. NULL if no request since the column landed.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Soft-delete: NULL = live. Auth checks reject soft-deleted users and public
    # reads filter them; it cascade-soft-deletes their geolocations.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Session-invalidation counter: the session JWT embeds it as `tv` and
    # `get_current_user` 401s on mismatch. Bumped on logout, password change,
    # password reset and soft-delete (clearing the cookie doesn't kill the token).
    token_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    # Plain-text bio, opt-in via PATCH /users/me.
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Server-minted, never typed by the owner: PUT /users/me/avatar stores one
    # stripped 400 px JPEG under `avatars/<user id>/`, DELETE clears both. Keeps
    # the picture on our own media host so a profile field can't be a beacon
    # collecting viewers' IPs.
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Keyed by platform (x, discord, website, github); ``{}`` default; PATCH
    # replaces wholesale.
    external_links: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, nullable=False, server_default="{}"
    )

    events = relationship("Event", back_populates="owner", foreign_keys="Event.owner_id")
