import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Where a conflict row came from. ``sync`` rows are managed by the daily
# Wikipedia ongoing-conflicts sync; ``seed`` rows by the one-shot Wikidata
# historical seed; ``manual`` rows by an operator (the ``Other`` escape value
# ships in the migration). The alias is the value-domain source of truth: the
# column and the sync/seed writers derive from it.
ConflictSource = Literal["sync", "seed", "manual"]

# Which tier table of the Wikipedia ongoing-conflicts page a row was last
# seen in: major wars (10,000+ deaths/year), minor wars (1,000+), conflicts
# (100+). NULL for rows the sync has never seen (manual + unseen seed rows).
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

    Identity is the internal UUID; ``wikidata_id`` is the natural key the
    sync/seed writers upsert on, so a Wikipedia rename updates ``name`` in
    place instead of forking a duplicate row. ``ongoing`` mirrors presence on
    the Wikipedia ongoing-conflicts page (with a grace period, see
    ``services/conflict_sync``); rows are never deleted, an ended conflict
    stays selectable so archival footage remains taggable.
    """

    __tablename__ = "conflicts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Wikipedia-page names run long ("Armed conflict for control of the
    # favelas in Greater Rio de Janeiro"); 200 leaves headroom over tags' 100.
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    # Wikidata item id ("Q131569"). NULL for manual rows (``Other``); unique
    # among the rows that carry one.
    wikidata_id: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    start_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Wikipedia death-toll tier (see ``ConflictTier``); NULL for rows the
    # sync has never seen.
    tier: Mapped[str | None] = mapped_column(String(10), nullable=True)
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ongoing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Last time the daily sync saw this conflict on the ongoing page. NULL for
    # rows the sync has never seen (manual + never-listed seed rows), which the
    # grace-period deactivation therefore never touches.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[ConflictSource] = mapped_column(String(20), nullable=False)

    events = relationship("Event", secondary=event_conflicts, back_populates="conflicts")
