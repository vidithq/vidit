import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.event import TITLE_MAX_LENGTH


class Collection(Base):
    """A named, curated set of one analyst's own events.

    Personal: one owner, and an event joins a collection only when the same
    account owns both (the invariant lives in
    ``services/collections.add_event``, not in a SQL constraint, because it
    spans two tables). Two free-text fields carry what the collection is: the
    title, capped at the event title's own ``TITLE_MAX_LENGTH`` so one cap
    governs both, and a required short ``description`` saying what the
    collection holds, the same class of text as the profile bio and capped by
    ``schemas/collection.DESCRIPTION_MAX_LENGTH``. The items order themselves
    by when the events happened, so a collection is still a set of facts
    rather than a narrative: there is no manual position, no denormalized
    count and no version history.

    ``owner_id`` carries ``ON DELETE CASCADE``, unlike ``Event.owner_id``: a
    collection is one analyst's own shelf and nothing outlives their account,
    so a GDPR erasure passes straight through with no object left behind, the
    collection storing no file of its own.
    """

    __tablename__ = "collections"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    # What the collection holds, in one short paragraph. ``Text`` with no width
    # and the cap in the API layer, the shape ``User.bio`` takes, so moving the
    # cap costs no migration.
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # Takedown: NULL = visible, timestamp = withheld from every read but an
    # admin's, the same axis ``Event.hidden_at`` carries and reversible the
    # same way.
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    owner = relationship("User")
    # The membership rows, dropped with the collection. Order is not declared
    # here: what a collection lists is the chronology of the events it points
    # at (``services/collections``), which this table does not carry.
    items = relationship(
        "CollectionEvent",
        back_populates="collection",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # "This analyst's collections, newest first", the profile section's
        # only read.
        Index("ix_collections_owner_created_at", "owner_id", "created_at"),
    )


class CollectionEvent(Base):
    """One membership: this event is in this collection.

    PK is the pair, so adding an event twice is the same row and the add verb
    is idempotent without a read-then-write. The forward read ("what is in
    collection X") rides the PK's leading column; the reverse ("which of my
    collections hold event X", the add-to-collection popover) rides the index
    on ``event_id``.

    Both foreign keys cascade, so neither a hard-deleted event nor a
    hard-deleted collection can leave a membership pointing at nothing.
    """

    __tablename__ = "collection_events"

    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    collection = relationship("Collection", back_populates="items")

    __table_args__ = (Index("ix_collection_events_event_id", "event_id"),)
