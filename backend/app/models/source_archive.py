import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Where the link was found on the event. ``source_url`` is the event's declared
# footage source (the column of the same name); ``secondary_source`` is one of
# the analyst-submitted mirrors in ``event_source_links``; ``detected_from`` is
# the analyst's own post a machine draft was detected from (``events.
# detected_from_url``), provenance rather than footage origin; ``proof_link`` is
# an href carried by a link mark inside the proof body's Tiptap document.
SourceArchiveOrigin = Literal["source_url", "secondary_source", "detected_from", "proof_link"]

# Which service holds the snapshot, inferred from its host when the row is
# written: ``web.archive.org`` is ``wayback``, ``archive.ph`` / ``archive.today``
# are ``archive_today``. A discriminator on one stored URL, not a pair of slots:
# the read surface renders one icon and picks its glyph from this.
SourceArchiveProvider = Literal["wayback", "archive_today"]


class SourceArchive(Base):
    """One link on one event, and the archived copy an analyst recorded for it.

    A child table rather than a column on ``events`` because one event carries
    several links: its ``source_url``, its secondary source links, the post a
    machine draft was detected from, and every href in the proof body.

    One row per link, holding one snapshot from whichever provider produced it.
    The capture happens in the analyst's own browser, on the provider's own
    submit page, and ``POST /events/{event_id}/archives`` is where the resulting
    snapshot URL comes back (see ``services/source_archive``). A link either has
    a copy or it does not, so there is no queue state, no attempt counter and no
    per-provider slot: a second provider's snapshot of the same link would be
    redundancy the reader never asked for.

    ``(event_id, original_url)`` is unique, which is what makes a resubmission
    by the owner an overwrite: pasting a better snapshot corrects the row
    instead of adding a competing one.
    """

    __tablename__ = "source_archives"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The link as it appears on the event, byte for byte: it is half the
    # identity of the row and what the read surface matches ``source_url``
    # against, so it is never normalised.
    original_url: Mapped[str] = mapped_column(Text, nullable=False)
    origin: Mapped[SourceArchiveOrigin] = mapped_column(String(20), nullable=False)
    # The archived copy. NOT NULL: a row exists because a copy exists, so the
    # read surface treats the row's presence and the copy's presence as one
    # fact.
    snapshot_url: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[SourceArchiveProvider] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    event = relationship("Event", back_populates="archives")

    __table_args__ = (
        # One archived copy per link per event: the anchor that makes a
        # resubmission an overwrite rather than a duplicate.
        UniqueConstraint("event_id", "original_url", name="uq_source_archives_event_url"),
        # Pin the value domains at the DB, not just the app-layer Literals.
        # Mirrors ``SourceArchiveOrigin`` / ``SourceArchiveProvider``; keep them
        # in step.
        CheckConstraint(
            "origin IN ('source_url', 'secondary_source', 'detected_from', 'proof_link')",
            name="ck_source_archives_origin_valid",
        ),
        CheckConstraint(
            "provider IN ('wayback', 'archive_today')",
            name="ck_source_archives_provider_valid",
        ),
    )
