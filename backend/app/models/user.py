import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    x_handle: Mapped[str | None] = mapped_column(String(50), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[CreatedAt]
    last_seen_at: Mapped[datetime | None]
    deleted_at: Mapped[datetime | None]
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    bio: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    external_links: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")

    is_invite_minting_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )

    events = relationship("Event", back_populates="owner", foreign_keys="Event.owner_id")
    sponsor = relationship(
        "User",
        secondary="invite_codes",
        primaryjoin="User.id == InviteCode.used_by_id",
        secondaryjoin="User.id == InviteCode.created_by_id",
        viewonly=True,
        uselist=False,
    )

    @property
    def is_live(self) -> bool:
        return self.is_active and self.deleted_at is None
