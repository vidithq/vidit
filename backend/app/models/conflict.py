import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, CreatedAt, literal_check

ConflictOrigin = Literal["sync", "seed", "manual"]

ConflictTier = Literal["major", "minor", "conflict"]

# The importers truncate a label to it before writing, so an over-long one cannot raise a
# DataError.
CONFLICT_NAME_MAX_LENGTH = 200

event_conflicts = Table(
    "event_conflicts",
    Base.metadata,
    Column(
        "event_id",
        ForeignKey("events.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "conflict_id",
        ForeignKey("conflicts.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Conflict(Base):
    __tablename__ = "conflicts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(CONFLICT_NAME_MAX_LENGTH), unique=True)
    wikidata_id: Mapped[str | None] = mapped_column(String(20), unique=True)
    start_year: Mapped[int | None] = mapped_column(Integer)
    tier: Mapped[ConflictTier | None] = mapped_column(String(10))
    end_year: Mapped[int | None] = mapped_column(Integer)
    is_ongoing: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[datetime | None]
    origin: Mapped[ConflictOrigin] = mapped_column(String(20))
    created_at: Mapped[CreatedAt]

    events = relationship("Event", secondary=event_conflicts, back_populates="conflicts")

    __table_args__ = (
        literal_check("origin", ConflictOrigin, "ck_conflicts_origin_valid"),
        literal_check("tier", ConflictTier, "ck_conflicts_tier_valid", nullable=True),
    )
