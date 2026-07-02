import uuid
from typing import Literal

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Tag category domain. ``conflict`` / ``capture_source`` are curated taxonomies;
# ``free`` is user-typed. The alias is the value-domain source of truth — the
# column, the Read schema, and the generated frontend type all derive from it.
TagCategory = Literal["conflict", "capture_source", "free"]

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

    geolocations = relationship("Event", secondary=event_tags, back_populates="tags")
