import uuid

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

geolocation_tags = Table(
    "geolocation_tags",
    Base.metadata,
    Column(
        "geolocation_id",
        ForeignKey("geolocations.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)

    geolocations = relationship("Geolocation", secondary=geolocation_tags, back_populates="tags")
    bounties = relationship("Bounty", secondary="bounty_tags", back_populates="tags")
