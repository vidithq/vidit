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

# Where the link was found: ``source_url`` (declared footage source),
# ``secondary_source`` (a mirror in ``event_source_links``), ``detected_from``
# (``events.detected_from_url``, provenance), ``proof_link`` (an href in the
# proof body's Tiptap document).
SourceArchiveOrigin = Literal["source_url", "secondary_source", "detected_from", "proof_link"]

# Which service holds the snapshot, inferred from its host at write time
# (``services/source_archive.PROVIDER_HOSTS``). A discriminator on one stored
# URL, not a slot per service.
SourceArchiveProvider = Literal["wayback", "archive_today", "ghostarchive"]


class SourceArchive(Base):
    """One link on one event, and the archived copy an analyst recorded for it.

    A child table because an event carries several links (``source_url``,
    secondary links, the detection's origin post, proof-body hrefs).

    One row per link, one snapshot from whichever provider produced it. The
    capture happens in the analyst's browser and
    ``POST /events/{event_id}/archives`` takes the snapshot URL back
    (``services/source_archive``). A link has a copy or not: no queue state,
    attempt counter or per-provider slot.

    ``(event_id, original_url)`` is unique, so a resubmission by the owner
    overwrites instead of adding a competing row.
    """

    __tablename__ = "source_archives"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The link byte for byte, never normalised: half the row's identity and what
    # the read surface matches ``source_url`` against.
    original_url: Mapped[str] = mapped_column(Text, nullable=False)
    origin: Mapped[SourceArchiveOrigin] = mapped_column(String(20), nullable=False)
    # The archived copy. NOT NULL: the row exists because a copy exists.
    snapshot_url: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[SourceArchiveProvider] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    event = relationship("Event", back_populates="archives")

    __table_args__ = (
        # One archived copy per link per event (makes resubmission an overwrite).
        UniqueConstraint("event_id", "original_url", name="uq_source_archives_event_url"),
        # Pin the value domains at the DB. Mirrors ``SourceArchiveOrigin`` /
        # ``SourceArchiveProvider``; keep them in step.
        CheckConstraint(
            "origin IN ('source_url', 'secondary_source', 'detected_from', 'proof_link')",
            name="ck_source_archives_origin_valid",
        ),
        CheckConstraint(
            "provider IN ('wayback', 'archive_today', 'ghostarchive')",
            name="ck_source_archives_provider_valid",
        ),
    )
