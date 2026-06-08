import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, String, Text
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
    # Mandatory at the application layer when is_trusted=true (the trust mark
    # has to be substantiated to be useful as a public signal). Not enforced
    # at the DB level because historical rows would fight a NOT NULL.
    trust_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set to created_at by the pre-creation registration flow — every
    # ``users`` row only exists because the analyst clicked the link in
    # the confirmation email, so the timestamp is non-NULL for any row
    # minted after the pending_registrations migration. Legacy rows
    # (registered before the cutover, never verified) may still hold
    # NULL; nothing in the live code path branches on it today, but
    # keeping the column documents the moment of email control.
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    # Soft-delete: NULL = live account, timestamp = removed. Login + auth
    # checks reject soft-deleted users; public reads filter `deleted_at IS
    # NULL`. Pairs with `Geolocation.deleted_at` — soft-deleting a user
    # cascade-soft-deletes every geolocation they authored.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Demo flag — TRUE iff this user was created by the admin "Demo data"
    # seeder. Demo users have an unloggable password and a synthetic
    # `@vidit.invalid` email; the wipe button drops every is_demo=TRUE row.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Public profile fields — opt-in, set via PATCH /users/me. Bio is plain
    # text (no Tiptap, no inline media — the profile blurb is a short
    # signal, not a post). Avatar is a free-form URL today; the platform
    # has no upload pipeline for it yet.
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSONB object keyed by platform (x, discord, website, github). Default
    # ``{}`` so the read path is always "a dict, possibly empty" — never
    # NULL — and the PATCH semantics are wholesale-replace, not deep-merge.
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
