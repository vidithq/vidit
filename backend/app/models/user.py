import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # Nullable because an assembled profile exists before anyone logs in: it is
    # built from a consented X handle with no auth credentials, and gains an
    # email only when its owner claims it. Every self-registered or claimed
    # account still carries both (the registration + claim flows set them);
    # `claimed_at IS NULL` marks the unclaimed, credential-less state.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The X handle an assembled profile was built from — its pre-claim identity
    # (an unclaimed row has no email), stored lowercased without the leading
    # `@`. UNIQUE so re-consent reuses the existing profile instead of minting a
    # second. Distinct from `external_links["x"]`, a free-text display link the
    # owner sets; this is the verified assembly anchor.
    x_handle: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True)
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
    # When an owner took control. Defaults to insert time via `server_default`,
    # so every account that's owned at creation — self-registration, the demo
    # seeder, the mock scripts, a future public sign-up — is correct without each
    # path remembering to stamp it. The assembly pipeline is the sole exception:
    # it creates an *unclaimed* profile by inserting an explicit `claimed_at=None`,
    # so `claimed_at IS NULL` means "assembled, not yet claimed" (identified by
    # `x_handle` alone). A timestamp, not a boolean / credential-nullness, because
    # a profile claimed via OAuth has no password yet still counts as claimed.
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
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

    events = relationship("Event", back_populates="owner", foreign_keys="Event.owner_id")
