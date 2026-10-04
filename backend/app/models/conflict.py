import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Where a conflict row came from: ``sync`` (daily Wikipedia ongoing-conflicts
# sync), ``seed`` (one-shot Wikidata historical seed), ``manual`` (operator;
# the ``Other`` value ships in the migration).
ConflictSource = Literal["sync", "seed", "manual"]

# Tier table of the Wikipedia ongoing-conflicts page a row was last seen in:
# major wars (10,000+ deaths/year), minor wars (1,000+), conflicts (100+). NULL
# for rows the sync never saw.
ConflictTier = Literal["major", "minor", "conflict"]

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
    """One armed conflict in the curated referential.

    ``wikidata_id`` is the natural key the sync/seed writers upsert on, so a
    Wikipedia rename updates ``name`` in place. ``ongoing`` mirrors presence on
    the ongoing-conflicts page (with a grace period, ``services/conflict_sync``);
    rows are never deleted, so archival footage stays taggable.
    """

    __tablename__ = "conflicts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Wikipedia names run long; 200 leaves headroom over tags' 100.
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    # Wikidata item id ("Q131569"). NULL for manual rows; unique among the rest.
    wikidata_id: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    start_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # See ``ConflictTier``.
    tier: Mapped[str | None] = mapped_column(String(10), nullable=True)
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ongoing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Last time the daily sync saw it on the ongoing page. NULL rows are never
    # touched by the grace-period deactivation.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[ConflictSource] = mapped_column(String(20), nullable=False)

    events = relationship("Event", secondary=event_conflicts, back_populates="conflicts")
