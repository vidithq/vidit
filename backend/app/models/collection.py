import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.event import TITLE_MAX_LENGTH


class Collection(Base):
    """A named, curated set of one analyst's own events.

    One owner, and an event joins only when the same account owns both (checked
    in ``services/collections.add_event``; it spans two tables). The title is
    capped by the event's ``TITLE_MAX_LENGTH``. The required ``description`` is
    a Tiptap document capped on its text by
    ``schemas/collection.DESCRIPTION_MAX_LENGTH``. Items order by when the
    events happened: no manual position, denormalized count or version history.

    ``owner_id`` cascades, unlike ``Event.owner_id``: nothing outlives the
    owner's account, and a collection stores no file.
    """

    __tablename__ = "collections"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    # Tiptap document, the shape ``Event.proof`` takes minus images (dropped by
    # the write service). The empty-doc default catches ORM constructions that
    # omit it; inlined because the models layer must not import from services.
    description = mapped_column(
        JSONB, nullable=False, default=lambda: {"type": "doc", "content": []}
    )
    # Plain-text projection of ``description``, written on every write from
    # ``services/sanitize.tiptap_doc_text``. Stored because the search GIN index
    # would otherwise index node names and punctuation. No column width: the
    # 500-character cap is the API's.
    description_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Takedown: NULL = visible; same axis and reversal as ``Event.hidden_at``.
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
    # Membership rows. Order is the events' chronology (``services/collections``).
    items = relationship(
        "CollectionEvent",
        back_populates="collection",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # "This analyst's collections, newest first" (the profile's only read).
        Index("ix_collections_owner_created_at", "owner_id", "created_at"),
    )


class CollectionEvent(Base):
    """One membership: this event is in this collection.

    The pair PK makes the add verb idempotent without read-then-write. The
    forward read rides the PK; the reverse (the add-to-collection popover) rides
    the ``event_id`` index. Both FKs cascade.
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
