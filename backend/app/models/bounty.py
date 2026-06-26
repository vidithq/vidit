import uuid
from datetime import UTC, date, datetime
from typing import Any, Literal

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, String, Table, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Lifecycle values. Plain strings (mirrors `auth_events.event`) so a new state
# needs no migration. `open` set on insert; `fulfilled` as a side-effect of
# `POST /geolocations bounty_id=…`; `closed` by `POST /bounties/{id}/close`
# (author-only). The alias is the value-domain source of truth — column, Read
# schemas, and the generated frontend type all derive from it. The constants
# carry the alias type so assigning them to the column type-checks.
BountyStatus = Literal["open", "fulfilled", "closed"]
STATUS_OPEN: BountyStatus = "open"
STATUS_FULFILLED: BountyStatus = "fulfilled"
STATUS_CLOSED: BountyStatus = "closed"


bounty_tags = Table(
    "bounty_tags",
    Base.metadata,
    Column("bounty_id", ForeignKey("bounties.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class BountyClaim(Base):
    """Soft, public "I'm working on this" signal.

    Multi-claimer by design — geolocation is collaborative and partly
    competitive, several analysts may pull at the same media in parallel. The
    composite PK makes duplicate claims idempotent. Claims never gate the
    bounty's lifecycle: it can be fulfilled by an analyst who never claimed,
    and the `bounty_id` cascade drops claims on hard-delete.
    """

    __tablename__ = "bounty_claims"

    bounty_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("bounties.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        nullable=False,
    )

    bounty = relationship("Bounty", back_populates="claims")
    user = relationship("User")

    __table_args__ = (
        # "Who's working on bounty X right now?" — the detail page's query.
        Index("ix_bounty_claims_bounty_id_created_at", "bounty_id", "created_at"),
        # "What is this user working on?" — profile / dashboard view.
        Index("ix_bounty_claims_user_id", "user_id"),
    )


class Bounty(Base):
    """An unfinished geolocation: media + source the author couldn't place.

    Lifecycle (see also docs/api.md → Bounties): ``open`` → ``fulfilled`` (a
    geolocation was submitted from it) or ``closed`` (author withdrew).
    "Claimed" is not a state — it's a parallel multi-analyst signal via the
    ``bounty_claims`` junction.

    Media lives in the shared ``media`` table via a nullable ``media.bounty_id``
    column (XOR with ``media.geolocation_id``). Fulfilment rewrites those rows
    in place — S3 objects stay put. The pointer back to the resulting
    geolocation lives on ``Geolocation.originated_from_bounty_id``.
    """

    __tablename__ = "bounties"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    # The in-progress proof (a bounty is an unfinished geolocation): same Tiptap
    # JSON shape as ``Geolocation.proof``, but optional and image-free
    # (services/bounties.py sanitises it with ``allow_images=False``).
    proof: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # Optional metadata carried over when the bounty becomes a geolocation:
    # when the event happened, and when the source posted the media. A bounty is
    # an unfinished geolocation, so both may be unknown at posting time.
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[BountyStatus] = mapped_column(
        String(20), nullable=False, default=STATUS_OPEN, server_default=STATUS_OPEN
    )
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
    # Set when status transitions to a terminal value (fulfilled / closed).
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Soft-delete parity with Geolocation — same admin tooling applies.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TRUE iff created by the admin "Demo bounties" seeder. The UI uses it to
    # swap the synthetic source_url for a "synthetic" label so testers don't
    # click out to a 404. Dropped en masse by the wipe button; real submissions
    # never set this.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    author = relationship("User", foreign_keys=[author_id], back_populates="bounties")
    media = relationship(
        "Media",
        primaryjoin="Bounty.id == Media.bounty_id",
        back_populates="bounty",
        cascade="all, delete-orphan",
    )
    tags = relationship("Tag", secondary=bounty_tags, back_populates="bounties")
    claims = relationship(
        "BountyClaim",
        back_populates="bounty",
        cascade="all, delete-orphan",
        order_by="BountyClaim.created_at.desc()",
    )
    fulfilled_by = relationship(
        "Geolocation",
        # Filter out soft-deleted geolocations: otherwise a fulfilled bounty
        # whose geo was later admin-deleted would still surface it through the
        # API, leaking a hidden row. The partial unique index guarantees at most
        # one live geo per bounty, so ``uselist=False`` is safe. ``viewonly``
        # because the link is owned by the geolocation's column, not the bounty.
        primaryjoin=(
            "and_(Bounty.id == Geolocation.originated_from_bounty_id, "
            "Geolocation.deleted_at.is_(None))"
        ),
        uselist=False,
        viewonly=True,
    )

    __table_args__ = (
        # "Open bounties, newest first" — the dominant query.
        Index("ix_bounties_status_created_at", "status", "created_at"),
        Index("ix_bounties_author_id", "author_id"),
        # Cheap soft-delete filter on every public read.
        Index("ix_bounties_deleted_at", "deleted_at"),
    )
