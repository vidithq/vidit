import uuid

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt

# Mirrored by ``frontend/src/components/ui/TagPicker.tsx::TAG_NAME_MAX_LEN``; change both.
NAME_MAX_LENGTH = 100

# One catalogue of free tags, shared by events and their sources (``models/source.source_tags``).
# Conflicts are not tags (``models/conflict.py``); where a source comes from is its ``kind``.
event_tags = Table(
    "event_tags",
    Base.metadata,
    Column(
        "event_id",
        ForeignKey("events.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH), unique=True)
    created_at: Mapped[CreatedAt]

    events = relationship("Event", secondary=event_tags, back_populates="tags")
    sources = relationship("Source", secondary="source_tags", back_populates="tags")
