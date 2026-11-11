import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, UpdatedAt
from app.models.event import TITLE_MAX_LENGTH


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH))
    description: Mapped[str] = mapped_column(Text, default="")
    description_text: Mapped[str] = mapped_column(Text)
    hidden_at: Mapped[datetime | None]
    deleted_at: Mapped[datetime | None]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    owner = relationship("User")
    items = relationship(
        "CollectionEvent",
        back_populates="collection",
        cascade="all, delete-orphan",
    )

    __table_args__ = (Index("ix_collections_owner_created_at", "owner_id", "created_at"),)


class CollectionEvent(Base):
    __tablename__ = "collection_events"

    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    added_at: Mapped[CreatedAt]

    collection = relationship("Collection", back_populates="items")

    __table_args__ = (Index("ix_collection_events_event_id", "event_id"),)
