import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import Column, DateTime, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, literal_check

# Tag category domain: ``capture_source`` is curated, ``free`` is user-typed.
# Conflicts are not tags (``models/conflict.py``). Value-domain source of truth
# for the column, the Read schema and the generated frontend type.
TagCategory = Literal["capture_source", "free"]

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
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    category: Mapped[TagCategory] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    events = relationship("Event", secondary=event_tags, back_populates="tags")

    __table_args__ = (literal_check("category", TagCategory, "ck_tags_category_valid"),)
